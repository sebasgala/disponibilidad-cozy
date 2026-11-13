import { MigrationInterface, QueryRunner } from 'typeorm';

// Paso 3 (disponibilidad): consumidores RabbitMQ de los eventos de reservas.
//   eventos_reservas_procesados    idempotencia por `id` del sobre CloudEvent: el efecto y el reclamo van en la misma
//                                  transacción, así un reintento de RabbitMQ no descuenta ni suma dos veces.
//   retenciones_limpieza           una por orden tras el check-out: la habitación está sucia y su cupo queda retenido
//                                  hasta habitacion.limpia.lista (PENDIENTE → LIBERADA). Una fila LIBERADA sin check-out
//                                  previo hace de lápida si la limpieza llega antes que el check-out.
//   retenciones_limpieza_noches    cada noche retenida y cuánto se descontó de verdad (1, o 0 si ya no había cupo):
//                                  la liberación devuelve exactamente eso, nunca más.
// Los privilegios por defecto del esquema disponibilidad (1793000000000) ya dan acceso al rol disponibilidad: sin GRANT.
export class InventarioEventosReservas1793900000000 implements MigrationInterface {
  name = 'InventarioEventosReservas1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "disponibilidad"."eventos_reservas_procesados" (
        "eventoId" uuid NOT NULL,
        "tipo" varchar(60) NOT NULL,
        "resultado" varchar(30) NOT NULL,
        "procesadoEn" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_eventos_reservas_procesados" PRIMARY KEY ("eventoId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "disponibilidad"."retenciones_limpieza" (
        "ordenId" uuid NOT NULL,
        "habitacionId" uuid,
        "checkout" date,
        "estado" varchar(10) NOT NULL,
        "habitacionFisicaId" uuid,
        "creadaEn" timestamptz NOT NULL DEFAULT now(),
        "liberadaEn" timestamptz,
        CONSTRAINT "PK_retenciones_limpieza" PRIMARY KEY ("ordenId"),
        CONSTRAINT "CHK_retenciones_limpieza_estado" CHECK ("estado" IN ('PENDIENTE', 'LIBERADA') AND (("estado" = 'LIBERADA') = ("liberadaEn" IS NOT NULL))),
        CONSTRAINT "CHK_retenciones_limpieza_pendiente" CHECK ("estado" <> 'PENDIENTE' OR ("habitacionId" IS NOT NULL AND "checkout" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_retenciones_limpieza_pendientes" ON "disponibilidad"."retenciones_limpieza" ("checkout") WHERE "estado" = 'PENDIENTE'`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "disponibilidad"."retenciones_limpieza_noches" (
        "ordenId" uuid NOT NULL,
        "fecha" date NOT NULL,
        "cantidad" int NOT NULL,
        "devuelta" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_retenciones_limpieza_noches" PRIMARY KEY ("ordenId", "fecha"),
        CONSTRAINT "CHK_retenciones_limpieza_noches_cantidad" CHECK ("cantidad" IN (0, 1)),
        CONSTRAINT "FK_retenciones_limpieza_noches_orden" FOREIGN KEY ("ordenId") REFERENCES "disponibilidad"."retenciones_limpieza"("ordenId") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "disponibilidad"."retenciones_limpieza_noches"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disponibilidad"."retenciones_limpieza"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disponibilidad"."eventos_reservas_procesados"`);
  }
}
