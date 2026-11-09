import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { hoyIso } from '../../comun/alojamientos-consulta.utils';
import { EventosService } from '../../comun/v2/eventos.service';
import { RefHabitacionStock } from '../../catalogo/catalogo.puerto';
import { unidadesDisponibles } from './stock-envio';

export type MotivoStock = 'RESERVA' | 'CANCELACION' | 'INVENTARIO' | 'ESTADO';

const UN_DIA = 86_400_000;

// Noches [checkin, checkout) como fechas YYYY-MM-DD
export function nochesDe(checkin: string, checkout: string): string[] {
  const inicio = Date.parse(`${checkin}T00:00:00Z`);
  const cantidad = Math.round((Date.parse(`${checkout}T00:00:00Z`) - inicio) / UN_DIA);
  return Array.from({ length: cantidad }, (_, i) => new Date(inicio + i * UN_DIA).toISOString().slice(0, 10));
}

// Outbox de stock (patrón transactional outbox): quien cambia cupos llama a `encolar` DENTRO de la misma transacción.
// Si la transacción se deshace, no queda ningún aviso; si se confirma, el aviso queda garantizado aunque Booking esté
// caído (lo envía StockEnvioWorker con reintentos). Por eso un fallo de gRPC nunca bloquea una reserva.
//
// A lo sumo hay una fila PENDIENTE por (habitación, noche): lo que viaja es el stock ABSOLUTO del momento del envío,
// así que varios cambios seguidos sobre la misma noche se avisan con un solo mensaje (el último valor).
@Injectable()
export class StockOutboxService {
  constructor(private readonly eventos: EventosService) {}

  // Avisa que cambió el stock de estas noches de una habitación. Las noches pasadas no se avisan.
  // `habitacion`: sus códigos y si se vende, leídos del catálogo por quien llama ANTES de abrir su transacción (fase 8.2:
  // aquí no se lee el catálogo). null = la habitación no existe en el catálogo: no se avisa nada.
  async encolar(
    manager: EntityManager,
    habitacion: RefHabitacionStock | null,
    fechas: string[],
    motivo: MotivoStock,
    ordenId: string | null = null,
    correlacionId: string | null = null,
  ): Promise<void> {
    if (!habitacion) return;
    const habitacionId = habitacion.id;
    const hoy = hoyIso();
    const futuras = [...new Set(fechas)].filter((f) => f >= hoy).sort();
    if (futuras.length === 0) return;

    // Estado actual (dentro de la transacción, ya con los cupos nuevos) para el evento alojamiento.stock.actualizado
    const filas: { fecha: string; cupos: number }[] = await manager.query(
      `SELECT "fecha"::text AS "fecha", "cupos" FROM "disponibilidad"."disponibilidad_diaria" WHERE "habitacionId" = $1 AND "fecha" = ANY($2::date[]) ORDER BY "fecha"`,
      [habitacionId, futuras],
    );
    if (filas.length === 0) return;

    await manager.query(
      `INSERT INTO "disponibilidad"."outbox_stock" ("habitacionId", "fecha", "motivo", "ordenId")
       SELECT $1, f, $3, $4 FROM unnest($2::date[]) AS f ORDER BY f
       ON CONFLICT ("habitacionId", "fecha") WHERE "estado" = 'PENDIENTE'
       DO UPDATE SET "version" = "outbox_stock"."version" + 1, "motivo" = EXCLUDED."motivo", "ordenId" = EXCLUDED."ordenId"`,
      [habitacionId, filas.map((f) => f.fecha), motivo, ordenId],
    );

    // El evento va a la outbox de disponibilidad en esta misma transacción; el publicador le da su `sequence`
    await this.eventos.emitir(
      manager,
      filas.map((f) => ({
        tipo: 'alojamiento.stock.actualizado' as const,
        sujeto: `alojamientos/${habitacion.alojamientoCodigo}/habitaciones/${habitacion.codigo}/${f.fecha}`,
        alojamientoId: habitacion.alojamientoId,
        datos: {
          alojamientoId: habitacion.alojamientoCodigo,
          tipoHabitacionCodigo: habitacion.codigo,
          fecha: f.fecha,
          unidadesDisponibles: unidadesDisponibles({ cupos: f.cupos, habitacionActiva: habitacion.activo, alojamientoActivo: habitacion.alojamientoActivo }),
        },
      })),
      correlacionId,
    );
  }

  // Todas las noches futuras con inventario de una habitación (alta o baja de la habitación o del alojamiento)
  async encolarFuturas(manager: EntityManager, habitacion: RefHabitacionStock | null, motivo: MotivoStock = 'ESTADO'): Promise<void> {
    if (!habitacion) return;
    const filas: { fecha: string }[] = await manager.query(`SELECT "fecha"::text AS "fecha" FROM "disponibilidad"."disponibilidad_diaria" WHERE "habitacionId" = $1 AND "fecha" >= $2 ORDER BY "fecha"`, [habitacion.id, hoyIso()]);
    await this.encolar(manager, habitacion, filas.map((f) => f.fecha), motivo);
  }
}
