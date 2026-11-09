import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.0: preparación del monolito para separar servicios (catálogo, disponibilidad, reservas y usuarios).
//   ordenes             guarda lo que muestra del catálogo (código y nombre del alojamiento y de la habitación, y la
//                       política y el régimen de la habitación para las órdenes v1 que no los guardaron): reservas deja
//                       de unirse con alojamientos y habitaciones para mostrar una orden. Se rellena desde el catálogo.
//   retenciones_cupos   una retención de cupos por orden (ReservarCupos / LiberarCupos): reservar o liberar dos veces
//                       con la misma orden no descuenta ni devuelve dos veces. Se rellena con las órdenes existentes.
//   cotizaciones        "usadaEn": la marca la orden que la usa; la limpieza ya no consulta ordenes.
//   eventos_dominio     outbox interna entre dominios: el catálogo publica aquí las bajas y altas, y disponibilidad las
//                       convierte en avisos de stock (antes el catálogo escribía directo en outbox_stock).
// Ninguna tabla nueva lleva FK a otro dominio: las referencias entre dominios son lógicas.
export class Fase8Preparacion1792500000000 implements MigrationInterface {
  name = 'Fase8Preparacion1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        ADD "alojamientoCodigo" character varying(64),
        ADD "alojamientoNombre" character varying(255),
        ADD "habitacionCodigo" character varying(40),
        ADD "habitacionNombre" character varying(255),
        ADD "habitacionCancellationType" character varying(100),
        ADD "habitacionMealPlan" character varying(100)
    `);
    await queryRunner.query(`
      UPDATE "ordenes" o SET
        "alojamientoCodigo" = a."codigo", "alojamientoNombre" = a."nombre",
        "habitacionCodigo" = h."codigo", "habitacionNombre" = h."nombre",
        "habitacionCancellationType" = h."cancellationType", "habitacionMealPlan" = h."mealPlan"
      FROM "alojamientos" a, "habitaciones" h
      WHERE a."id" = o."alojamientoId" AND h."id" = o."habitacionId"
    `);
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        ALTER "alojamientoCodigo" SET NOT NULL, ALTER "alojamientoNombre" SET NOT NULL,
        ALTER "habitacionCodigo" SET NOT NULL, ALTER "habitacionNombre" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "retenciones_cupos" (
        "ordenId" uuid NOT NULL,
        "habitacionId" uuid NOT NULL,
        "checkin" date NOT NULL,
        "checkout" date NOT NULL,
        "cantidad" integer NOT NULL,
        "estado" character varying(10) NOT NULL DEFAULT 'RETENIDA',
        "creadaEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "liberadaEn" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_retenciones_cupos" PRIMARY KEY ("ordenId"),
        CONSTRAINT "CHK_retenciones_cupos_cantidad" CHECK ("cantidad" > 0),
        CONSTRAINT "CHK_retenciones_cupos_fechas" CHECK ("checkout" > "checkin"),
        CONSTRAINT "CHK_retenciones_cupos_estado" CHECK ("estado" IN ('RETENIDA', 'LIBERADA') AND (("estado" = 'LIBERADA') = ("liberadaEn" IS NOT NULL)))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_retenciones_cupos_habitacion" ON "retenciones_cupos" ("habitacionId", "checkin")`);
    // Las órdenes existentes ya descontaron su cupo: su retención queda RETENIDA, o LIBERADA si se cancelaron
    await queryRunner.query(`
      INSERT INTO "retenciones_cupos" ("ordenId", "habitacionId", "checkin", "checkout", "cantidad", "estado", "creadaEn", "liberadaEn")
      SELECT "id", "habitacionId", "checkin", "checkout", "habitacionesReservadas",
             CASE WHEN "status"::text = 'CANCELLED' THEN 'LIBERADA' ELSE 'RETENIDA' END, "createdAt",
             CASE WHEN "status"::text = 'CANCELLED' THEN COALESCE("canceladaEn", "updatedAt") END
      FROM "ordenes"
    `);

    await queryRunner.query(`ALTER TABLE "cotizaciones" ADD "usadaEn" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "cotizaciones" c SET "usadaEn" = o."createdAt" FROM "ordenes" o WHERE o."cotizacionId" = c."id"`);

    await queryRunner.query(`
      CREATE TABLE "eventos_dominio" (
        "id" BIGSERIAL NOT NULL,
        "origen" character varying(30) NOT NULL,
        "tipo" character varying(80) NOT NULL,
        "datos" jsonb NOT NULL,
        "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "procesadoEn" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_eventos_dominio" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_eventos_dominio_pendientes" ON "eventos_dominio" ("id") WHERE "procesadoEn" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "eventos_dominio"`);
    await queryRunner.query(`ALTER TABLE "cotizaciones" DROP COLUMN "usadaEn"`);
    await queryRunner.query(`DROP TABLE "retenciones_cupos"`);
    await queryRunner.query(`
      ALTER TABLE "ordenes"
        DROP COLUMN "habitacionMealPlan", DROP COLUMN "habitacionCancellationType", DROP COLUMN "habitacionNombre",
        DROP COLUMN "habitacionCodigo", DROP COLUMN "alojamientoNombre", DROP COLUMN "alojamientoCodigo"
    `);
  }
}
