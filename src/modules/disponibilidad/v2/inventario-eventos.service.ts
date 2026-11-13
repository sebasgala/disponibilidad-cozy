import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { hoyIso } from '../../comun/alojamientos-consulta.utils';
import { AuditoriaService } from '../../comun/auditoria.service';
import { CatalogoPuerto, RefHabitacionStock } from '../../catalogo/catalogo.puerto';
import { CuposService } from '../cupos.service';
import { MotivoStock, nochesDe, StockOutboxService } from './stock-outbox.service';
import { CONEXION } from '../../../database/conexiones';

// Paso 3: inventario gobernado por los eventos de reservas (consumidos de RabbitMQ, exchange cozy.reservas).
//
//   alojamiento.reserva.confirmada   descuenta 1 cupo en cada noche [checkin, checkout). Todo o nada, con las noches
//                                    bloqueadas (FOR UPDATE): si alguna está en 0 no se descuenta ninguna, se deja una
//                                    alerta y se sincroniza a Booking el 0 de esas noches.
//   alojamiento.reserva.cancelada    devuelve lo que la orden retenía, sin pasar nunca de cuposTotales.
//   alojamiento.checkout.completado  NO libera nada: la habitación queda sucia y su cupo retenido desde el día de salida.
//   habitacion.limpia.lista          devuelve el cupo retenido por limpieza en las noches de hoy en adelante.
//
// Sin doble conteo con la saga: la compra ya descuenta los cupos de forma síncrona (CuposService.reservar) y la
// cancelación ya los devuelve (CuposService.liberar), ambas con la retención por orden (retenciones_cupos) como libro.
// Estos consumidores usan ese mismo libro: si la orden ya tiene retención, el evento no cambia cupos.
//
// Idempotencia en dos niveles: el `id` del sobre CloudEvent se reclama en eventos_reservas_procesados en la misma
// transacción que el efecto (un reintento de RabbitMQ no hace nada), y cada efecto está atado a la orden.

export const EVENTO_RESERVA_CONFIRMADA = 'alojamiento.reserva.confirmada';
export const EVENTO_RESERVA_CANCELADA = 'alojamiento.reserva.cancelada';
export const EVENTO_CHECKOUT_COMPLETADO = 'alojamiento.checkout.completado';
export const EVENTO_HABITACION_LIMPIA_LISTA = 'habitacion.limpia.lista';
export const TIPOS_CONSUMIDOS = [EVENTO_RESERVA_CONFIRMADA, EVENTO_RESERVA_CANCELADA, EVENTO_CHECKOUT_COMPLETADO, EVENTO_HABITACION_LIMPIA_LISTA] as const;

export const ALERTA_RESERVA_SIN_CUPO = 'reserva_sin_cupo';
export const ALERTA_LIMPIEZA_SIN_CUPO = 'limpieza_sin_cupo';

export type ResultadoEvento =
  | 'DESCONTADA'
  | 'YA_DESCONTADA'
  | 'SIN_CUPO'
  | 'LIBERADA'
  | 'YA_LIBERADA'
  | 'SIN_RETENCION'
  | 'RETENIDA_LIMPIEZA'
  | 'YA_RETENIDA'
  | 'LIMPIEZA_LIBERADA'
  | 'YA_LIMPIA'
  | 'SIN_RETENCION_LIMPIEZA'
  | 'HABITACION_DESCONOCIDA'
  | 'DATOS_INCOMPLETOS'
  | 'DUPLICADO'
  | 'IGNORADO';

// Sobre CloudEvents tal como llega de RabbitMQ (solo lo que se usa)
export interface EventoEntrante {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Lee el cuerpo del mensaje; null si no es un CloudEvent utilizable (se manda a la DLQ sin reintentar)
export function leerEvento(cuerpo: Buffer | string): EventoEntrante | null {
  try {
    const e = JSON.parse(typeof cuerpo === 'string' ? cuerpo : cuerpo.toString('utf8'));
    if (!e || typeof e.id !== 'string' || !UUID.test(e.id) || typeof e.type !== 'string') return null;
    if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) return null;
    return { id: e.id.toLowerCase(), type: e.type, data: e.data };
  } catch {
    return null;
  }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const fecha = (v: unknown): string | null => (typeof v === 'string' && FECHA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);

// Lo que cada evento aporta, normalizado. Las reservas usan `orderId`; habitacion.limpia.lista, `reservaId`.
export interface DatosInventario {
  ordenId: string | null;
  alojamientoCodigo: string | null;
  tipoHabitacionCodigo: string | null;
  checkin: string | null;
  checkout: string | null;
  habitacionFisicaId: string | null;
}

export function datosDe(evento: EventoEntrante): DatosInventario {
  const d = evento.data;
  const orden = texto(d.orderId) ?? texto(d.reservaId);
  return {
    ordenId: orden && UUID.test(orden) ? orden.toLowerCase() : null,
    alojamientoCodigo: texto(d.alojamientoId),
    tipoHabitacionCodigo: texto(d.tipoHabitacionCodigo),
    checkin: fecha(d.checkin),
    checkout: fecha(d.checkout),
    habitacionFisicaId: texto(d.habitacionFisicaId),
  };
}

// ───────────────────────── Acceso a datos (una transacción) ─────────────────────────

export interface RetencionCuposFila {
  habitacionId: string;
  checkin: string;
  checkout: string;
  cantidad: number;
  estado: 'RETENIDA' | 'LIBERADA';
}

export interface RetencionLimpiezaFila {
  habitacionId: string | null;
  checkout: string | null;
  estado: 'PENDIENTE' | 'LIBERADA';
}

export interface NocheLimpieza {
  fecha: string;
  cantidad: number;
  devuelta: boolean;
}

export interface Alerta {
  accion: string;
  habitacionId: string;
  datos: Record<string, unknown>;
}

export interface AlmacenInventario {
  reclamarEvento(eventoId: string, tipo: string): Promise<boolean>;
  anotarResultado(eventoId: string, resultado: ResultadoEvento): Promise<void>;
  // Retención de cupos de la orden, bloqueada (FOR UPDATE); null si la orden no retiene nada
  retencionCupos(ordenId: string): Promise<RetencionCuposFila | null>;
  // Noches [checkin, checkout) de la habitación, bloqueadas en orden de fecha (FOR UPDATE)
  bloquearNoches(habitacionId: string, checkin: string, checkout: string): Promise<{ fecha: string; cupos: number }[]>;
  // Descuenta 1 en cada noche y deja la retención de la orden (CuposService.reservar). Lanza si no pudo con todas.
  descontarUnoPorNoche(ordenId: string, habitacionId: string, checkin: string, checkout: string): Promise<void>;
  // Devuelve la retención de la orden (CuposService.liberar, con tope en cuposTotales)
  liberarRetencion(ordenId: string): Promise<void>;
  retencionLimpieza(ordenId: string): Promise<RetencionLimpiezaFila | null>;
  crearRetencionLimpieza(ordenId: string, habitacionId: string, checkout: string): Promise<void>;
  // Lápida: la limpieza llegó sin check-out previo; un check-out posterior ya no retiene nada
  crearLapidaLimpieza(ordenId: string, habitacionFisicaId: string | null): Promise<void>;
  liberarRetencionLimpieza(ordenId: string, habitacionFisicaId: string | null): Promise<void>;
  nochesLimpieza(ordenId: string): Promise<NocheLimpieza[]>;
  // Descuenta 1 en esa noche solo si queda cupo (cupos > 0). Devuelve cuánto descontó: 1 o 0.
  descontarNocheSiHay(habitacionId: string, fecha: string): Promise<number>;
  anotarNocheLimpieza(ordenId: string, fecha: string, cantidad: number): Promise<boolean>;
  // +1 en esa noche sin pasar de cuposTotales
  devolverNoche(habitacionId: string, fecha: string): Promise<void>;
  marcarNochesDevueltas(ordenId: string): Promise<void>;
  alertar(alerta: Alerta): Promise<void>;
  encolarStock(habitacion: RefHabitacionStock | null, fechas: string[], motivo: MotivoStock, ordenId: string | null): Promise<void>;
}

// Retenciones de limpieza todavía sucias cuyo día de hoy aún no está retenido (lectura sin bloqueo)
export interface PendienteLimpieza {
  ordenId: string;
  habitacionId: string;
}

export interface FuenteInventario {
  enTransaccion<T>(trabajo: (almacen: AlmacenInventario) => Promise<T>): Promise<T>;
  // Lecturas previas sin transacción (fase 8.2: el catálogo se lee antes de abrir la transacción)
  habitacionDeRetencion(ordenId: string): Promise<string | null>;
  pendientesSinNoche(hoy: string): Promise<PendienteLimpieza[]>;
}

export interface ResolutorHabitaciones {
  porCodigos(alojamientoCodigo: string, tipoHabitacionCodigo: string): Promise<RefHabitacionStock | null>;
  porIds(ids: string[]): Promise<Map<string, RefHabitacionStock>>;
}

// ───────────────────────── Lógica ─────────────────────────

export class LogicaInventario {
  private readonly log = new Logger('InventarioEventos');

  constructor(
    private readonly fuente: FuenteInventario,
    private readonly habitaciones: ResolutorHabitaciones,
    private readonly hoy: () => string = hoyIso,
  ) {}

  async procesar(evento: EventoEntrante): Promise<ResultadoEvento> {
    if (!(TIPOS_CONSUMIDOS as readonly string[]).includes(evento.type)) return 'IGNORADO';
    const d = datosDe(evento);

    // Antes de la transacción: la habitación del catálogo (por la retención de la orden o por los códigos del evento)
    const candidatas: string[] = [];
    const deRetencion = d.ordenId ? await this.fuente.habitacionDeRetencion(d.ordenId) : null;
    if (deRetencion) candidatas.push(deRetencion);
    const porCodigos = d.alojamientoCodigo && d.tipoHabitacionCodigo ? await this.habitaciones.porCodigos(d.alojamientoCodigo, d.tipoHabitacionCodigo) : null;
    const conocidas = candidatas.length ? await this.habitaciones.porIds(candidatas) : new Map<string, RefHabitacionStock>();
    if (porCodigos) conocidas.set(porCodigos.id, porCodigos);

    return this.fuente.enTransaccion(async (a) => {
      if (!(await a.reclamarEvento(evento.id, evento.type))) return 'DUPLICADO';
      const resultado = await this.aplicar(a, evento.type, d, porCodigos, conocidas);
      await a.anotarResultado(evento.id, resultado);
      if (resultado === 'SIN_CUPO' || resultado === 'HABITACION_DESCONOCIDA' || resultado === 'DATOS_INCOMPLETOS') {
        this.log.warn(`${evento.type} ${evento.id} (orden ${d.ordenId ?? '?'}): ${resultado}`);
      }
      return resultado;
    });
  }

  private aplicar(a: AlmacenInventario, tipo: string, d: DatosInventario, porCodigos: RefHabitacionStock | null, conocidas: Map<string, RefHabitacionStock>): Promise<ResultadoEvento> {
    if (!d.ordenId) return Promise.resolve('DATOS_INCOMPLETOS');
    switch (tipo) {
      case EVENTO_RESERVA_CONFIRMADA:
        return this.confirmada(a, d.ordenId, d, porCodigos);
      case EVENTO_RESERVA_CANCELADA:
        return this.cancelada(a, d.ordenId, conocidas);
      case EVENTO_CHECKOUT_COMPLETADO:
        return this.checkout(a, d.ordenId, d, porCodigos, conocidas);
      default:
        return this.limpia(a, d.ordenId, d, conocidas);
    }
  }

  // Regla 1: descuento estricto por noche exacta, sin overbooking
  private async confirmada(a: AlmacenInventario, ordenId: string, d: DatosInventario, habitacion: RefHabitacionStock | null): Promise<ResultadoEvento> {
    const retencion = await a.retencionCupos(ordenId);
    // La saga ya descontó (o ya devolvió por cancelación): el evento no vuelve a tocar cupos
    if (retencion) return retencion.estado === 'LIBERADA' ? 'YA_LIBERADA' : 'YA_DESCONTADA';
    if (!d.checkin || !d.checkout || d.checkout <= d.checkin) return 'DATOS_INCOMPLETOS';
    if (!habitacion) return 'HABITACION_DESCONOCIDA';

    const noches = nochesDe(d.checkin, d.checkout);
    const filas = await a.bloquearNoches(habitacion.id, d.checkin, d.checkout);
    const cupoDe = new Map(filas.map((f) => [f.fecha, f.cupos]));
    const agotadas = noches.filter((f) => !((cupoDe.get(f) ?? 0) > 0));
    if (agotadas.length > 0) {
      // Ninguna noche se descuenta (todo o nada) y Booking recibe el 0 real de las agotadas
      await a.alertar({ accion: ALERTA_RESERVA_SIN_CUPO, habitacionId: habitacion.id, datos: { ordenId, checkin: d.checkin, checkout: d.checkout, nochesSinCupo: agotadas } });
      await a.encolarStock(habitacion, agotadas, 'RESERVA', ordenId);
      return 'SIN_CUPO';
    }
    await a.descontarUnoPorNoche(ordenId, habitacion.id, d.checkin, d.checkout);
    await a.encolarStock(habitacion, noches, 'RESERVA', ordenId);
    return 'DESCONTADA';
  }

  // Regla 2: liberación inmediata por cancelación (solo lo que la orden retenía)
  private async cancelada(a: AlmacenInventario, ordenId: string, conocidas: Map<string, RefHabitacionStock>): Promise<ResultadoEvento> {
    const retencion = await a.retencionCupos(ordenId);
    if (!retencion) return 'SIN_RETENCION';
    if (retencion.estado === 'LIBERADA') return 'YA_LIBERADA';
    await a.liberarRetencion(ordenId);
    await a.encolarStock(conocidas.get(retencion.habitacionId) ?? null, nochesDe(retencion.checkin, retencion.checkout), 'CANCELACION', ordenId);
    return 'LIBERADA';
  }

  // Regla 3a: el check-out no libera; la habitación queda retenida por limpieza desde el día de salida
  private async checkout(a: AlmacenInventario, ordenId: string, d: DatosInventario, porCodigos: RefHabitacionStock | null, conocidas: Map<string, RefHabitacionStock>): Promise<ResultadoEvento> {
    const existente = await a.retencionLimpieza(ordenId);
    if (existente) return existente.estado === 'LIBERADA' ? 'YA_LIMPIA' : 'YA_RETENIDA';
    const retencion = await a.retencionCupos(ordenId);
    const habitacion = (retencion && conocidas.get(retencion.habitacionId)) ?? porCodigos;
    const checkout = retencion?.checkout ?? d.checkout;
    if (!habitacion) return 'HABITACION_DESCONOCIDA';
    if (!checkout) return 'DATOS_INCOMPLETOS';
    await a.crearRetencionLimpieza(ordenId, habitacion.id, checkout);
    const hoy = this.hoy();
    if (hoy >= checkout) await this.retenerNoche(a, ordenId, habitacion, hoy);
    return 'RETENIDA_LIMPIEZA';
  }

  // Regla 3b: la habitación quedó limpia; devuelve el cupo retenido de hoy en adelante
  private async limpia(a: AlmacenInventario, ordenId: string, d: DatosInventario, conocidas: Map<string, RefHabitacionStock>): Promise<ResultadoEvento> {
    const retencion = await a.retencionLimpieza(ordenId);
    if (!retencion) {
      await a.crearLapidaLimpieza(ordenId, d.habitacionFisicaId);
      return 'SIN_RETENCION_LIMPIEZA';
    }
    if (retencion.estado === 'LIBERADA') return 'YA_LIMPIA';
    const hoy = this.hoy();
    const aDevolver = (await a.nochesLimpieza(ordenId)).filter((n) => !n.devuelta && n.cantidad === 1 && n.fecha >= hoy).map((n) => n.fecha);
    for (const f of aDevolver) await a.devolverNoche(retencion.habitacionId, f);
    await a.marcarNochesDevueltas(ordenId);
    await a.liberarRetencionLimpieza(ordenId, d.habitacionFisicaId);
    if (aDevolver.length) await a.encolarStock(conocidas.get(retencion.habitacionId) ?? null, aDevolver, 'ESTADO', ordenId);
    return 'LIMPIEZA_LIBERADA';
  }

  // Retiene (−1) la noche `fecha` para una habitación sucia. Idempotente por (orden, noche). Sin cupo: alerta, nunca negativo.
  private async retenerNoche(a: AlmacenInventario, ordenId: string, habitacion: RefHabitacionStock, fecha: string): Promise<void> {
    const ya = (await a.nochesLimpieza(ordenId)).some((n) => n.fecha === fecha);
    if (ya) return;
    const descontada = await a.descontarNocheSiHay(habitacion.id, fecha);
    await a.anotarNocheLimpieza(ordenId, fecha, descontada);
    if (descontada === 0) {
      await a.alertar({ accion: ALERTA_LIMPIEZA_SIN_CUPO, habitacionId: habitacion.id, datos: { ordenId, fecha, motivo: 'habitación sucia sin cupo que retener (vendida o sin inventario)' } });
    }
    await a.encolarStock(habitacion, [fecha], 'ESTADO', ordenId);
  }

  // Cada día que una habitación sigue sucia después de su salida, ese día también queda retenido
  async extenderRetencionesDeLimpieza(): Promise<number> {
    const hoy = this.hoy();
    const pendientes = await this.fuente.pendientesSinNoche(hoy);
    if (pendientes.length === 0) return 0;
    const habitaciones = await this.habitaciones.porIds([...new Set(pendientes.map((p) => p.habitacionId))]);
    let retenidas = 0;
    for (const p of pendientes) {
      const habitacion = habitaciones.get(p.habitacionId);
      if (!habitacion) continue;
      await this.fuente.enTransaccion(async (a) => {
        const r = await a.retencionLimpieza(p.ordenId);
        if (r?.estado !== 'PENDIENTE') return;
        await this.retenerNoche(a, p.ordenId, habitacion, hoy);
        retenidas++;
      });
    }
    return retenidas;
  }
}

// ───────────────────────── Implementación SQL ─────────────────────────

const ESQ = '"disponibilidad"';

class AlmacenSql implements AlmacenInventario {
  constructor(
    private readonly m: EntityManager,
    private readonly cupos: CuposService,
    private readonly stock: StockOutboxService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async reclamarEvento(eventoId: string, tipo: string): Promise<boolean> {
    const filas: unknown[] = await this.m.query(
      `INSERT INTO ${ESQ}."eventos_reservas_procesados" ("eventoId", "tipo", "resultado") VALUES ($1, $2, 'EN_CURSO') ON CONFLICT DO NOTHING RETURNING "eventoId"`,
      [eventoId, tipo],
    );
    return filas.length > 0;
  }

  async anotarResultado(eventoId: string, resultado: ResultadoEvento): Promise<void> {
    await this.m.query(`UPDATE ${ESQ}."eventos_reservas_procesados" SET "resultado" = $2 WHERE "eventoId" = $1`, [eventoId, resultado]);
  }

  async retencionCupos(ordenId: string): Promise<RetencionCuposFila | null> {
    const [f] = await this.m.query(
      `SELECT "habitacionId", "checkin"::text AS "checkin", "checkout"::text AS "checkout", "cantidad", "estado" FROM ${ESQ}."retenciones_cupos" WHERE "ordenId" = $1 FOR UPDATE`,
      [ordenId],
    );
    return f ?? null;
  }

  bloquearNoches(habitacionId: string, checkin: string, checkout: string): Promise<{ fecha: string; cupos: number }[]> {
    return this.m.query(
      `SELECT "fecha"::text AS "fecha", "cupos" FROM ${ESQ}."disponibilidad_diaria" WHERE "habitacionId" = $1 AND "fecha" >= $2 AND "fecha" < $3 ORDER BY "fecha" FOR UPDATE`,
      [habitacionId, checkin, checkout],
    );
  }

  async descontarUnoPorNoche(ordenId: string, habitacionId: string, checkin: string, checkout: string): Promise<void> {
    const r = await this.cupos.reservar(this.m, { ordenId, habitacionId, checkin, checkout, cantidad: 1 }, null);
    // Con las noches ya bloqueadas no debería pasar; si pasa, la transacción entera (y el reclamo del evento) se deshace
    if (!r.ok) throw new Error(`No se pudo descontar la orden ${ordenId}: ${r.motivo}`);
  }

  async liberarRetencion(ordenId: string): Promise<void> {
    await this.cupos.liberar(this.m, ordenId);
  }

  async retencionLimpieza(ordenId: string): Promise<RetencionLimpiezaFila | null> {
    const [f] = await this.m.query(
      `SELECT "habitacionId", "checkout"::text AS "checkout", "estado" FROM ${ESQ}."retenciones_limpieza" WHERE "ordenId" = $1 FOR UPDATE`,
      [ordenId],
    );
    return f ?? null;
  }

  async crearRetencionLimpieza(ordenId: string, habitacionId: string, checkout: string): Promise<void> {
    await this.m.query(`INSERT INTO ${ESQ}."retenciones_limpieza" ("ordenId", "habitacionId", "checkout", "estado") VALUES ($1, $2, $3, 'PENDIENTE')`, [ordenId, habitacionId, checkout]);
  }

  async crearLapidaLimpieza(ordenId: string, habitacionFisicaId: string | null): Promise<void> {
    await this.m.query(
      `INSERT INTO ${ESQ}."retenciones_limpieza" ("ordenId", "estado", "habitacionFisicaId", "liberadaEn") VALUES ($1, 'LIBERADA', $2, now()) ON CONFLICT DO NOTHING`,
      [ordenId, habitacionFisicaId],
    );
  }

  async liberarRetencionLimpieza(ordenId: string, habitacionFisicaId: string | null): Promise<void> {
    await this.m.query(
      `UPDATE ${ESQ}."retenciones_limpieza" SET "estado" = 'LIBERADA', "liberadaEn" = now(), "habitacionFisicaId" = COALESCE($2, "habitacionFisicaId") WHERE "ordenId" = $1`,
      [ordenId, habitacionFisicaId],
    );
  }

  nochesLimpieza(ordenId: string): Promise<NocheLimpieza[]> {
    return this.m.query(`SELECT "fecha"::text AS "fecha", "cantidad", "devuelta" FROM ${ESQ}."retenciones_limpieza_noches" WHERE "ordenId" = $1 ORDER BY "fecha"`, [ordenId]);
  }

  async descontarNocheSiHay(habitacionId: string, fecha: string): Promise<number> {
    const filas: unknown[] = await this.m.query(
      `UPDATE ${ESQ}."disponibilidad_diaria" SET "cupos" = "cupos" - 1 WHERE "habitacionId" = $1 AND "fecha" = $2 AND "cupos" > 0 RETURNING "fecha"`,
      [habitacionId, fecha],
    );
    return Array.isArray(filas) && filas.length > 0 ? 1 : 0;
  }

  async anotarNocheLimpieza(ordenId: string, fecha: string, cantidad: number): Promise<boolean> {
    const filas: unknown[] = await this.m.query(
      `INSERT INTO ${ESQ}."retenciones_limpieza_noches" ("ordenId", "fecha", "cantidad") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING "fecha"`,
      [ordenId, fecha, cantidad],
    );
    return filas.length > 0;
  }

  async devolverNoche(habitacionId: string, fecha: string): Promise<void> {
    await this.m.query(`UPDATE ${ESQ}."disponibilidad_diaria" SET "cupos" = LEAST("cupos" + 1, "cuposTotales") WHERE "habitacionId" = $1 AND "fecha" = $2`, [habitacionId, fecha]);
  }

  async marcarNochesDevueltas(ordenId: string): Promise<void> {
    await this.m.query(`UPDATE ${ESQ}."retenciones_limpieza_noches" SET "devuelta" = true WHERE "ordenId" = $1`, [ordenId]);
  }

  async alertar(alerta: Alerta): Promise<void> {
    await this.auditoria.registrar(this.m, { modulo: 'disponibilidad', usuarioId: null, accion: alerta.accion, entidad: 'habitacion', entidadId: alerta.habitacionId, despues: alerta.datos });
  }

  encolarStock(habitacion: RefHabitacionStock | null, fechas: string[], motivo: MotivoStock, ordenId: string | null): Promise<void> {
    return this.stock.encolar(this.m, habitacion, fechas, motivo, ordenId);
  }
}

@Injectable()
export class InventarioEventosService {
  readonly logica: LogicaInventario;

  constructor(
    @InjectDataSource(CONEXION.disponibilidad) dataSource: DataSource,
    cupos: CuposService,
    stock: StockOutboxService,
    auditoria: AuditoriaService,
    catalogo: CatalogoPuerto,
  ) {
    const fuente: FuenteInventario = {
      enTransaccion: (trabajo) => dataSource.transaction((m) => trabajo(new AlmacenSql(m, cupos, stock, auditoria))),
      habitacionDeRetencion: async (ordenId) => {
        const [f] = await dataSource.query(`SELECT "habitacionId" FROM ${ESQ}."retenciones_cupos" WHERE "ordenId" = $1`, [ordenId]);
        return f?.habitacionId ?? null;
      },
      pendientesSinNoche: (hoy) =>
        dataSource.query(
          `SELECT r."ordenId", r."habitacionId" FROM ${ESQ}."retenciones_limpieza" r
           WHERE r."estado" = 'PENDIENTE' AND r."checkout" <= $1
             AND NOT EXISTS (SELECT 1 FROM ${ESQ}."retenciones_limpieza_noches" n WHERE n."ordenId" = r."ordenId" AND n."fecha" = $1)
           ORDER BY r."checkout", r."ordenId" LIMIT 200`,
          [hoy],
        ),
    };
    const habitaciones: ResolutorHabitaciones = {
      porCodigos: async (alojamientoCodigo, tipoHabitacionCodigo) => {
        const alojamiento = await catalogo.alojamientoPorCodigo(alojamientoCodigo);
        if (!alojamiento) return null;
        return (await catalogo.habitaciones({ alojamientoId: alojamiento.id, codigo: tipoHabitacionCodigo }))[0] ?? null;
      },
      porIds: (ids) => catalogo.habitacionesPorIds(ids),
    };
    this.logica = new LogicaInventario(fuente, habitaciones);
  }

  procesar(evento: EventoEntrante): Promise<ResultadoEvento> {
    return this.logica.procesar(evento);
  }

  extenderRetencionesDeLimpieza(): Promise<number> {
    return this.logica.extenderRetencionesDeLimpieza();
  }
}
