import { MigrationInterface, QueryRunner } from 'typeorm';

// Integración v2 (fase 3): planes de tarifa, restricciones por noche y cotizaciones con precio congelado.
// Solo crea tablas nuevas: no toca las existentes.
//   planes_tarifa     planes ADICIONALES de una habitación (el plan por defecto, ESTANDAR, se deriva de la habitación)
//   restricciones_dia estancia mínima/máxima, cierres y anticipación de una habitación en una noche
//   cotizaciones      precio congelado 30 minutos por POST /api/v2/alojamientos/availability (no retiene cupo)
const REGIMENES = `'SOLO_HABITACION', 'DESAYUNO_INCLUIDO', 'MEDIA_PENSION', 'PENSION_COMPLETA', 'TODO_INCLUIDO'`;
const MODELOS_PAGO = `'PREPAGO', 'PAGO_EN_HOTEL', 'GARANTIA_TARJETA'`;

export class ContratoV2Precios1792100000000 implements MigrationInterface {
  name = 'ContratoV2Precios1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "planes_tarifa" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "habitacionId" uuid NOT NULL,
        "codigo" character varying(30) NOT NULL,
        "nombre" character varying(100) NOT NULL,
        "regimen" character varying(20) NOT NULL,
        "modeloPago" character varying(20) NOT NULL DEFAULT 'PREPAGO',
        "esReembolsable" boolean NOT NULL,
        "horasLimiteCancelacion" integer,
        "penalidadPorcentaje" numeric(5,2),
        "ajustePorcentaje" numeric(5,2) NOT NULL DEFAULT 0,
        "ocupacionBase" integer NOT NULL DEFAULT 2,
        "suplementoAdultoExtra" numeric(10,2) NOT NULL DEFAULT 0,
        "edadMaximaGratisNinos" integer NOT NULL DEFAULT 17,
        "suplementoNino" numeric(10,2) NOT NULL DEFAULT 0,
        "activo" boolean NOT NULL DEFAULT true,
        "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_planes_tarifa" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_planes_tarifa_habitacion_codigo" UNIQUE ("habitacionId", "codigo"),
        CONSTRAINT "CHK_planes_tarifa_codigo" CHECK ("codigo" ~ '^[A-Z0-9_]{2,30}$' AND "codigo" <> 'ESTANDAR'),
        CONSTRAINT "CHK_planes_tarifa_regimen" CHECK ("regimen" IN (${REGIMENES})),
        CONSTRAINT "CHK_planes_tarifa_modelo_pago" CHECK ("modeloPago" IN (${MODELOS_PAGO})),
        CONSTRAINT "CHK_planes_tarifa_ajuste" CHECK ("ajustePorcentaje" BETWEEN -90 AND 500),
        CONSTRAINT "CHK_planes_tarifa_ocupacion" CHECK ("ocupacionBase" BETWEEN 1 AND 20),
        CONSTRAINT "CHK_planes_tarifa_suplementos" CHECK ("suplementoAdultoExtra" >= 0 AND "suplementoNino" >= 0),
        CONSTRAINT "CHK_planes_tarifa_edad" CHECK ("edadMaximaGratisNinos" BETWEEN 0 AND 17),
        CONSTRAINT "CHK_planes_tarifa_cancelacion" CHECK (("horasLimiteCancelacion" IS NULL OR "horasLimiteCancelacion" BETWEEN 0 AND 720) AND ("penalidadPorcentaje" IS NULL OR "penalidadPorcentaje" BETWEEN 0 AND 100)),
        CONSTRAINT "FK_planes_tarifa_habitacionId" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "restricciones_dia" (
        "habitacionId" uuid NOT NULL,
        "fecha" date NOT NULL,
        "estanciaMinima" integer,
        "estanciaMaxima" integer,
        "cerradoALlegada" boolean NOT NULL DEFAULT false,
        "cerradoASalida" boolean NOT NULL DEFAULT false,
        "ventaCerrada" boolean NOT NULL DEFAULT false,
        "anticipacionMinimaHoras" integer,
        CONSTRAINT "PK_restricciones_dia" PRIMARY KEY ("habitacionId", "fecha"),
        CONSTRAINT "CHK_restricciones_estancia" CHECK (("estanciaMinima" IS NULL OR "estanciaMinima" BETWEEN 1 AND 30) AND ("estanciaMaxima" IS NULL OR "estanciaMaxima" BETWEEN 1 AND 30) AND ("estanciaMinima" IS NULL OR "estanciaMaxima" IS NULL OR "estanciaMinima" <= "estanciaMaxima")),
        CONSTRAINT "CHK_restricciones_anticipacion" CHECK ("anticipacionMinimaHoras" IS NULL OR "anticipacionMinimaHoras" BETWEEN 0 AND 8760),
        CONSTRAINT "FK_restricciones_dia_habitacionId" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "cotizaciones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "alojamientoId" integer NOT NULL,
        "habitacionId" uuid NOT NULL,
        "planTarifaCodigo" character varying(30) NOT NULL,
        "fechaInicio" date NOT NULL,
        "fechaFin" date NOT NULL,
        "cantidadHabitaciones" integer NOT NULL,
        "ocupantes" jsonb NOT NULL,
        "plan" jsonb NOT NULL,
        "desglose" jsonb NOT NULL,
        "totalCentavos" bigint NOT NULL,
        "moneda" character varying(3) NOT NULL DEFAULT 'USD',
        "creadaEn" TIMESTAMP WITH TIME ZONE NOT NULL,
        "validaHasta" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_cotizaciones" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_cotizaciones_fechas" CHECK ("fechaFin" > "fechaInicio"),
        CONSTRAINT "CHK_cotizaciones_habitaciones" CHECK ("cantidadHabitaciones" BETWEEN 1 AND 10),
        CONSTRAINT "CHK_cotizaciones_total" CHECK ("totalCentavos" >= 0),
        CONSTRAINT "CHK_cotizaciones_vigencia" CHECK ("validaHasta" > "creadaEn"),
        CONSTRAINT "FK_cotizaciones_alojamientoId" FOREIGN KEY ("alojamientoId") REFERENCES "alojamientos"("id"),
        CONSTRAINT "FK_cotizaciones_habitacionId" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IX_cotizaciones_alojamientoId" ON "cotizaciones" ("alojamientoId")`);
    await queryRunner.query(`CREATE INDEX "IX_cotizaciones_habitacionId" ON "cotizaciones" ("habitacionId")`);
    await queryRunner.query(`CREATE INDEX "IX_cotizaciones_validaHasta" ON "cotizaciones" ("validaHasta")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cotizaciones"`);
    await queryRunner.query(`DROP TABLE "restricciones_dia"`);
    await queryRunner.query(`DROP TABLE "planes_tarifa"`);
  }
}
