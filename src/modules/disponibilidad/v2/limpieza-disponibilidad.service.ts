import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CONEXION } from '../../../database/conexiones';

const borrados = (r: unknown): number => (Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 0);

// Limpieza y estado de las tablas de disponibilidad (fase 8.0: cada dominio limpia lo suyo)
//   outbox_stock   los avisos ya enviados o rechazados, pasados 7 días (los PENDIENTES nunca se borran)
//   cotizaciones   las vencidas hace más de un día que ninguna orden usó (las usadas son el respaldo del precio)
@Injectable()
export class LimpiezaDisponibilidadService {
  constructor(@InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource) {}

  async limpiar(): Promise<{ outboxStock: number; cotizaciones: number }> {
    return {
      outboxStock: borrados(await this.dataSource.query(`DELETE FROM "disponibilidad"."outbox_stock" WHERE "estado" IN ('ENVIADO', 'RECHAZADO') AND COALESCE("enviadoEn", "creadoEn") < now() - interval '7 days'`)),
      cotizaciones: borrados(await this.dataSource.query(`DELETE FROM "disponibilidad"."cotizaciones" WHERE "validaHasta" < now() - interval '1 day' AND "usadaEn" IS NULL`)),
    };
  }

  // Estado de la outbox de stock para el superadmin
  async estadoOutbox() {
    const [conteo] = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE "estado" = 'PENDIENTE')::int AS "pendientes",
              COUNT(*) FILTER (WHERE "estado" = 'ENVIADO')::int AS "enviados",
              COUNT(*) FILTER (WHERE "estado" = 'RECHAZADO')::int AS "rechazados",
              COUNT(*) FILTER (WHERE "estado" = 'PENDIENTE' AND "intentos" > 0)::int AS "pendientesConFallos",
              COALESCE(MAX("intentos") FILTER (WHERE "estado" = 'PENDIENTE'), 0)::int AS "intentosMaximos",
              EXTRACT(EPOCH FROM (now() - MIN("creadoEn") FILTER (WHERE "estado" = 'PENDIENTE')))::int AS "pendienteMasAntiguaSegundos",
              MAX("enviadoEn") AS "ultimoEnvioEn"
       FROM "disponibilidad"."outbox_stock"`,
    );
    const [ultimoError] = await this.dataSource.query(
      `SELECT "ultimoError", "fecha"::text AS "fecha", "intentos" FROM "disponibilidad"."outbox_stock" WHERE "ultimoError" IS NOT NULL ORDER BY "id" DESC LIMIT 1`,
    );
    return {
      ...conteo,
      pendienteMasAntiguaSegundos: conteo.pendienteMasAntiguaSegundos ?? null,
      ultimoEnvioEn: conteo.ultimoEnvioEn ? new Date(conteo.ultimoEnvioEn).toISOString() : null,
      ultimoError: ultimoError ? { mensaje: ultimoError.ultimoError, fecha: ultimoError.fecha, intentos: ultimoError.intentos } : null,
    };
  }
}
