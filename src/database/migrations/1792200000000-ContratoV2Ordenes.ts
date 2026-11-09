import { MigrationInterface, QueryRunner } from 'typeorm';

// Integración v2 (fase 4): órdenes del contrato (create, get, listado, cancel) e idempotencia completa.
// Aditiva: columnas nuevas y opcionales en `ordenes` (la v1 sigue igual) y la tabla nueva `idempotencia_v2`.
export class ContratoV2Ordenes1792200000000 implements MigrationInterface {
  name = 'ContratoV2Ordenes1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        ADD "sagaId" character varying(64),
        ADD "claveIdempotencia" uuid,
        ADD "cotizacionId" uuid,
        ADD "planTarifaCodigo" character varying(30),
        ADD "regimen" character varying(20),
        ADD "modeloPago" character varying(20),
        ADD "metodoPago" character varying(30),
        ADD "huespedTitular" jsonb,
        ADD "huespedesAdicionales" jsonb,
        ADD "peticionesEspeciales" text,
        ADD "desgloseFiscal" jsonb,
        ADD "politicaCancelacion" jsonb,
        ADD "codigoReembolso" character varying(20),
        ADD "refundStatus" character varying(20),
        ADD "porcentajeReembolso" numeric(5,2),
        ADD "montoReembolsado" numeric(10,2),
        ADD "solicitadoPor" character varying(30),
        ADD "motivoCancelacion" character varying(300),
        ADD "canceladaEn" TIMESTAMP WITH TIME ZONE
    `);
    // Las canceladas antes de esta migración: la última modificación es la cancelación
    await queryRunner.query(`UPDATE "ordenes" SET "canceladaEn" = "updatedAt" WHERE "status" = 'CANCELLED'`);
    await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "UQ_ordenes_codigoReembolso" UNIQUE ("codigoReembolso")`);
    await queryRunner.query(
      `ALTER TABLE "ordenes" ADD CONSTRAINT "CHK_ordenes_reembolso" CHECK (("porcentajeReembolso" IS NULL OR "porcentajeReembolso" BETWEEN 0 AND 100) AND ("montoReembolsado" IS NULL OR "montoReembolsado" >= 0))`,
    );
    await queryRunner.query(
      `ALTER TABLE "ordenes" ADD CONSTRAINT "FK_ordenes_cotizacionId" FOREIGN KEY ("cotizacionId") REFERENCES "cotizaciones"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IX_ordenes_sagaId" ON "ordenes" ("sagaId")`);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_claveIdempotencia" ON "ordenes" ("claveIdempotencia")`);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_cotizacionId" ON "ordenes" ("cotizacionId")`);

    await queryRunner.query(`
      CREATE TABLE "idempotencia_v2" (
        "clave" uuid NOT NULL,
        "operacion" character varying(120) NOT NULL,
        "huella" character varying(64) NOT NULL,
        "estado" character varying(12) NOT NULL,
        "statusCode" integer,
        "respuesta" json,
        "cabeceras" json,
        "creadaEn" TIMESTAMP WITH TIME ZONE NOT NULL,
        "actualizadaEn" TIMESTAMP WITH TIME ZONE NOT NULL,
        "expiraEn" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_idempotencia_v2" PRIMARY KEY ("clave"),
        CONSTRAINT "CHK_idempotencia_v2_estado" CHECK ("estado" IN ('EN_CURSO', 'COMPLETADA'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IX_idempotencia_v2_expiraEn" ON "idempotencia_v2" ("expiraEn")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "idempotencia_v2"`);
    await queryRunner.query(`DROP INDEX "IX_ordenes_cotizacionId"`);
    await queryRunner.query(`DROP INDEX "IX_ordenes_claveIdempotencia"`);
    await queryRunner.query(`DROP INDEX "IX_ordenes_sagaId"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "FK_ordenes_cotizacionId"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "CHK_ordenes_reembolso"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "UQ_ordenes_codigoReembolso"`);
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        DROP COLUMN "canceladaEn", DROP COLUMN "motivoCancelacion", DROP COLUMN "solicitadoPor", DROP COLUMN "montoReembolsado",
        DROP COLUMN "porcentajeReembolso", DROP COLUMN "refundStatus", DROP COLUMN "codigoReembolso", DROP COLUMN "politicaCancelacion",
        DROP COLUMN "desgloseFiscal", DROP COLUMN "peticionesEspeciales", DROP COLUMN "huespedesAdicionales", DROP COLUMN "huespedTitular",
        DROP COLUMN "metodoPago", DROP COLUMN "modeloPago", DROP COLUMN "regimen", DROP COLUMN "planTarifaCodigo", DROP COLUMN "cotizacionId",
        DROP COLUMN "claveIdempotencia", DROP COLUMN "sagaId"
    `);
  }
}
