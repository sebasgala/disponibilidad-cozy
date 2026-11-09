import { MigrationInterface, QueryRunner } from 'typeorm';

// Integración v2 (fase 5): aviso de stock a Booking por gRPC y feed de eventos, con el patrón outbox.
// Solo crea tablas nuevas.
//   outbox_stock      una fila por (habitación, noche) con el stock por avisar. Se escribe en la MISMA transacción que
//                     cambia los cupos; un proceso aparte la envía por gRPC con reintentos. A lo sumo una fila PENDIENTE
//                     por (habitación, noche): lo que se envía es el valor ABSOLUTO del momento del envío.
//   outbox_eventos    feed de CloudEvents del contrato (GET /eventos), con `sequence` sin saltos.
//   evento_secuencia  contador de `sequence`: se incrementa dentro de la transacción del evento, así la numeración sigue
//                     el orden de commit y un rollback no deja huecos.
export class ContratoV2Stock1792300000000 implements MigrationInterface {
  name = 'ContratoV2Stock1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_stock" (
        "id" BIGSERIAL NOT NULL,
        "habitacionId" uuid NOT NULL,
        "fecha" date NOT NULL,
        "motivo" character varying(20) NOT NULL,
        "ordenId" uuid,
        "estado" character varying(12) NOT NULL DEFAULT 'PENDIENTE',
        "version" integer NOT NULL DEFAULT 1,
        "intentos" integer NOT NULL DEFAULT 0,
        "proximoIntentoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "enviandoHasta" TIMESTAMP WITH TIME ZONE,
        "ultimoError" character varying(300),
        "unidadesEnviadas" integer,
        "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "enviadoEn" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_outbox_stock" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_outbox_stock_estado" CHECK ("estado" IN ('PENDIENTE', 'ENVIADO', 'RECHAZADO')),
        CONSTRAINT "CHK_outbox_stock_motivo" CHECK ("motivo" IN ('RESERVA', 'CANCELACION', 'INVENTARIO', 'ESTADO')),
        CONSTRAINT "FK_outbox_stock_habitacionId" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id") ON DELETE CASCADE
      )
    `);
    // A lo sumo una fila pendiente por habitación y noche (el aviso lleva el valor del momento del envío)
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_outbox_stock_pendiente" ON "outbox_stock" ("habitacionId", "fecha") WHERE "estado" = 'PENDIENTE'`);
    await queryRunner.query(`CREATE INDEX "IX_outbox_stock_pendientes" ON "outbox_stock" ("proximoIntentoEn") WHERE "estado" = 'PENDIENTE'`);
    await queryRunner.query(`CREATE INDEX "IX_outbox_stock_enviadoEn" ON "outbox_stock" ("enviadoEn")`);

    await queryRunner.query(`
      CREATE TABLE "outbox_eventos" (
        "sequence" bigint NOT NULL,
        "id" uuid NOT NULL,
        "tipo" character varying(60) NOT NULL,
        "sujeto" character varying(200) NOT NULL,
        "alojamientoId" integer,
        "correlacionId" character varying(64),
        "datos" jsonb NOT NULL,
        "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_outbox_eventos" PRIMARY KEY ("sequence"),
        CONSTRAINT "UQ_outbox_eventos_id" UNIQUE ("id"),
        CONSTRAINT "CHK_outbox_eventos_sequence" CHECK ("sequence" >= 1),
        CONSTRAINT "CHK_outbox_eventos_tipo" CHECK ("tipo" IN ('alojamiento.reserva.confirmada', 'alojamiento.reserva.cancelada', 'alojamiento.checkin.completado', 'alojamiento.checkout.completado', 'alojamiento.stock.actualizado'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IX_outbox_eventos_tipo" ON "outbox_eventos" ("tipo", "sequence")`);
    await queryRunner.query(`CREATE INDEX "IX_outbox_eventos_alojamientoId" ON "outbox_eventos" ("alojamientoId", "sequence")`);

    await queryRunner.query(`
      CREATE TABLE "evento_secuencia" (
        "id" integer NOT NULL,
        "ultimo" bigint NOT NULL,
        CONSTRAINT "PK_evento_secuencia" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_evento_secuencia_unica" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(`INSERT INTO "evento_secuencia" ("id", "ultimo") VALUES (1, 0)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "evento_secuencia"`);
    await queryRunner.query(`DROP TABLE "outbox_eventos"`);
    await queryRunner.query(`DROP TABLE "outbox_stock"`);
  }
}
