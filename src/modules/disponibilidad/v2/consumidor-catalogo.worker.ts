import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditoriaService } from '../../comun/auditoria.service';
import { hoyIso } from '../../comun/alojamientos-consulta.utils';
import { CatalogoPuerto } from '../../catalogo/catalogo.puerto';
import { StockOutboxService } from './stock-outbox.service';
import { CONEXION } from '../../../database/conexiones';

const INTERVALO_MS = 500;
const LOTE = 20;

// Consume los eventos del catálogo (fase 8.0): un alojamiento o una habitación dados de baja o reactivados cambian el
// stock que ve Booking en todas sus noches futuras (0 mientras estén de baja). Antes el catálogo escribía directo en
// outbox_stock dentro de su transacción; ahora publica el evento y este dominio decide qué avisar.
// Cada evento se procesa y se marca en la misma transacción: si algo falla, se reintenta en la próxima vuelta.
// Fase 9.0 (E1): los eventos están en catalogo.eventos_catalogo, que este módulo solo LEE. Lo que ya procesó lo guarda en su
// esquema (disponibilidad.eventos_catalogo_procesados), no en la tabla del catálogo: un evento está pendiente si no tiene fila ahí.
// Fase 8.2: el catálogo (códigos y estado de cada habitación) se lee ANTES de abrir esa transacción. Primero se miran
// los eventos pendientes sin bloquearlos, se leen sus habitaciones y después se bloquean y procesan solo esos.
// Fase 8.2, decisión D2 (opción a): si una BAJA afecta a habitaciones con reservas vigentes, se deja una alerta para el
// administrador en disponibilidad.auditoria_disponibilidad (accion 'baja_con_reservas_vigentes'), en la misma transacción que procesa el evento.
// El catálogo ya rechaza la baja con reservas vigentes (409); esto detecta la carrera en que una compra entra entre esa
// comprobación y el commit de la baja. No cancela nada ni cambia lo que hace la baja: la cerrará la saga de 8.4.

// Un evento del catálogo, tal como lo lee este módulo
export interface EventoCatalogo {
  id: string;
  tipo: string;
  datos: Record<string, any>;
}

const SQL_PENDIENTES = `
SELECT e."id"::text AS "id", e."tipo", e."datos" FROM "catalogo"."eventos_catalogo" e
WHERE e."origen" = 'catalogo'
  AND NOT EXISTS (SELECT 1 FROM "disponibilidad"."eventos_catalogo_procesados" p WHERE p."eventoId" = e."id")
ORDER BY e."id" LIMIT $1`;

// Reclama un evento para procesarlo: si otra instancia ya lo procesó, no devuelve nada; si lo está procesando, espera a
// que termine (la clave primaria) y entonces tampoco devuelve nada.
const SQL_RECLAMAR = `INSERT INTO "disponibilidad"."eventos_catalogo_procesados" ("eventoId") VALUES ($1) ON CONFLICT DO NOTHING RETURNING "eventoId"`;

// Habitaciones a las que afecta un evento del catálogo
export function habitacionesDelEvento(evento: Pick<EventoCatalogo, 'tipo' | 'datos'>): string[] {
  if (evento.tipo === 'catalogo.alojamiento.estado_cambiado') return evento.datos.habitacionIds ?? [];
  if (evento.tipo === 'catalogo.habitacion.estado_cambiado') return [evento.datos.habitacionId];
  return [];
}

// Solo las bajas alertan: una reactivación no deja a nadie sin habitación
export function esBaja(evento: Pick<EventoCatalogo, 'tipo' | 'datos'>): boolean {
  return (evento.tipo === 'catalogo.alojamiento.estado_cambiado' || evento.tipo === 'catalogo.habitacion.estado_cambiado') && evento.datos?.activo === false;
}

export const ACCION_ALERTA_BAJA = 'baja_con_reservas_vigentes';

// Una retención vigente: cupos todavía tomados por una orden (confirmada o con el huésped alojado) con salida posterior a hoy
export interface RetencionVigente {
  ordenId: string;
  habitacionId: string;
  checkin: string;
  checkout: string;
  cantidad: number;
}

@Injectable()
export class ConsumidorCatalogoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ConsumidorCatalogo');
  private temporizador: NodeJS.Timeout | null = null;
  private trabajando = false;

  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly stock: StockOutboxService,
    private readonly catalogo: CatalogoPuerto,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => void this.vuelta(), INTERVALO_MS);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  private async vuelta(): Promise<void> {
    if (this.trabajando) return;
    this.trabajando = true;
    try {
      while ((await this.procesarLote()) === LOTE);
    } catch (error) {
      this.log.error(`No se pudo procesar un evento del catálogo: ${(error as Error).message}`);
    } finally {
      this.trabajando = false;
    }
  }

  // Procesa hasta LOTE eventos pendientes, en orden. Devuelve cuántos procesó (menos de LOTE si otra instancia ya había
  // procesado algunos de los que se miraron).
  async procesarLote(): Promise<number> {
    // 1. Sin transacción: los pendientes y, del catálogo, el estado actual de sus habitaciones
    const vistos: EventoCatalogo[] = await this.dataSource.query(SQL_PENDIENTES, [LOTE]);
    if (vistos.length === 0) return 0;
    const habitaciones = await this.catalogo.habitacionesPorIds([...new Set(vistos.flatMap(habitacionesDelEvento))]);

    // 2. En la transacción: cada evento se reclama (fila en eventos_catalogo_procesados) y se procesa; si otra instancia lo
    //    tenía, se salta. Si algo falla, se deshacen el reclamo y lo hecho, y se reintenta en la vuelta siguiente.
    return this.dataSource.transaction(async (manager) => {
      let procesados = 0;
      for (const evento of vistos) {
        const reclamado: unknown[] = await manager.query(SQL_RECLAMAR, [evento.id]);
        if (reclamado.length === 0) continue;
        const afectadas = habitacionesDelEvento(evento);
        for (const habitacionId of afectadas) await this.stock.encolarFuturas(manager, habitaciones.get(habitacionId) ?? null, 'ESTADO');
        if (esBaja(evento)) await this.alertarSiHayReservasVigentes(manager, evento, afectadas);
        procesados++;
      }
      return procesados;
    });
  }

  // D2 (opción a): con reservas vigentes en las habitaciones dadas de baja, una fila de auditoría para el administrador.
  // Lee solo retenciones_cupos (de este dominio). Va en la transacción del evento: un reintento no la duplica.
  // «Vigente» se corta con hoyIso(), igual que ReservasVigentesService (reservas/admin/reservas-vigentes.ts), la
  // comprobación que hace el catálogo antes de la baja: las dos tienen que contar el mismo día.
  private async alertarSiHayReservasVigentes(manager: EntityManager, evento: EventoCatalogo, habitacionIds: string[]): Promise<void> {
    if (habitacionIds.length === 0) return;
    const vigentes: RetencionVigente[] = await manager.query(
      `SELECT "ordenId", "habitacionId", "checkin"::text AS "checkin", "checkout"::text AS "checkout", "cantidad"
       FROM "disponibilidad"."retenciones_cupos"
       WHERE "habitacionId" = ANY($1::uuid[]) AND "estado" = 'RETENIDA' AND "checkout" > $2
       ORDER BY "checkin", "ordenId"`,
      [habitacionIds, hoyIso()],
    );
    if (vigentes.length === 0) return;
    const deAlojamiento = evento.tipo === 'catalogo.alojamiento.estado_cambiado';
    await this.auditoria.registrar(manager, {
      modulo: 'disponibilidad',
      usuarioId: null, // la escribe el sistema, no un usuario
      accion: ACCION_ALERTA_BAJA,
      entidad: deAlojamiento ? 'alojamiento' : 'habitacion',
      entidadId: deAlojamiento ? evento.datos.alojamientoId : evento.datos.habitacionId,
      despues: { eventoId: String(evento.id), tipoEvento: evento.tipo, reservasVigentes: vigentes.length, retenciones: vigentes },
    });
    this.log.warn(
      `Baja con reservas vigentes (${evento.tipo} ${deAlojamiento ? evento.datos.alojamientoId : evento.datos.habitacionId}): ` +
        `${vigentes.length} órdenes (${vigentes.slice(0, 10).map((v) => v.ordenId).join(', ')}${vigentes.length > 10 ? '…' : ''}). ` +
        `Revisar la baja en disponibilidad.auditoria_disponibilidad (accion '${ACCION_ALERTA_BAJA}').`,
    );
  }
}
