import { MigrationInterface, QueryRunner } from 'typeorm';

// Integración v2 (fase 7): estancia (check-in / check-out), reseñas y acuerdo B2B de promociones.
//   ordenes               dos estados nuevos (CHECKED_IN, CHECKED_OUT) y las columnas de la estancia. Todo opcional: la v1 no lo usa.
//   resenas               una por reserva (UNIQUE sobre ordenId), solo de reservas CHECKED_OUT.
//   promociones_contrato  el acuerdo B2B del nodo: una sola fila (id = 1), la fija un administrador con PUT.
// Los valores nuevos del enum no se usan en esta transacción (PostgreSQL lo prohíbe): el CHECK compara contra texto.
export class ContratoV2Estancia1792400000000 implements MigrationInterface {
  name = 'ContratoV2Estancia1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."ordenes_status_enum" ADD VALUE IF NOT EXISTS 'CHECKED_IN'`);
    await queryRunner.query(`ALTER TYPE "public"."ordenes_status_enum" ADD VALUE IF NOT EXISTS 'CHECKED_OUT'`);
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        ADD "earlyCheckinAutorizado" boolean NOT NULL DEFAULT false,
        ADD "earlyCheckinDesde" TIMESTAMP WITH TIME ZONE,
        ADD "earlyCheckinMotivo" character varying(200),
        ADD "checkInEn" TIMESTAMP WITH TIME ZONE,
        ADD "habitacionAsignada" character varying(100),
        ADD "claveAccesoDigital" character varying(40),
        ADD "checkOutEn" TIMESTAMP WITH TIME ZONE,
        ADD "consumosAdicionales" numeric(10,2),
        ADD "consumos" jsonb,
        ADD "metodoPagoConsumos" character varying(20),
        ADD "paquete" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "ordenes" ADD CONSTRAINT "CHK_ordenes_estancia" CHECK (
        ("status"::text NOT IN ('CHECKED_IN', 'CHECKED_OUT') OR "checkInEn" IS NOT NULL)
        AND ("status"::text <> 'CHECKED_OUT' OR "checkOutEn" IS NOT NULL)
        AND ("consumosAdicionales" IS NULL OR "consumosAdicionales" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "resenas" (
        "id" SERIAL NOT NULL,
        "ordenId" uuid NOT NULL,
        "alojamientoId" integer NOT NULL,
        "clienteId" uuid,
        "calificacionGlobal" numeric(4,2) NOT NULL,
        "desglose" jsonb,
        "comentario" text NOT NULL,
        "tipoViaje" character varying(10),
        "autorNombre" character varying(100) NOT NULL,
        "autorPais" character varying(60),
        "tipoHabitacion" character varying(100),
        "fecha" date NOT NULL,
        "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_resenas" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resenas_ordenId" UNIQUE ("ordenId"),
        CONSTRAINT "CHK_resenas_calificacion" CHECK ("calificacionGlobal" BETWEEN 1 AND 10),
        CONSTRAINT "CHK_resenas_tipoViaje" CHECK ("tipoViaje" IS NULL OR "tipoViaje" IN ('SOLO', 'PAREJA', 'FAMILIA', 'NEGOCIOS', 'GRUPO')),
        CONSTRAINT "FK_resenas_ordenId" FOREIGN KEY ("ordenId") REFERENCES "ordenes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_resenas_alojamientoId" FOREIGN KEY ("alojamientoId") REFERENCES "alojamientos"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_resenas_clienteId" FOREIGN KEY ("clienteId") REFERENCES "usuarios"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IX_resenas_alojamientoId" ON "resenas" ("alojamientoId", "creadoEn" DESC, "id")`);

    await queryRunner.query(`
      CREATE TABLE "promociones_contrato" (
        "id" smallint NOT NULL DEFAULT 1,
        "permitePromociones" boolean NOT NULL,
        "porcentajeMaximo" numeric(5,2) NOT NULL,
        "destinos" jsonb NOT NULL DEFAULT '[]',
        "vigenciaDesde" date NOT NULL,
        "vigenciaHasta" date,
        "condicionesCombo" character varying(500),
        "contactoComercial" jsonb,
        "actualizadoPor" uuid,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promociones_contrato" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_promociones_contrato_unica" CHECK ("id" = 1),
        CONSTRAINT "CHK_promociones_contrato_porcentaje" CHECK ("porcentajeMaximo" BETWEEN 0 AND 50 AND ("permitePromociones" OR "porcentajeMaximo" = 0))
      )
    `);
  }

  // Los valores del enum no se pueden quitar de PostgreSQL: quedan (sin uso) al revertir
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "promociones_contrato"`);
    await queryRunner.query(`DROP TABLE "resenas"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "CHK_ordenes_estancia"`);
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        DROP COLUMN "paquete", DROP COLUMN "metodoPagoConsumos", DROP COLUMN "consumos", DROP COLUMN "consumosAdicionales",
        DROP COLUMN "checkOutEn", DROP COLUMN "claveAccesoDigital", DROP COLUMN "habitacionAsignada", DROP COLUMN "checkInEn",
        DROP COLUMN "earlyCheckinMotivo", DROP COLUMN "earlyCheckinDesde", DROP COLUMN "earlyCheckinAutorizado"
    `);
  }
}
