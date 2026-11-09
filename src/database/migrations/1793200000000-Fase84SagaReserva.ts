import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.4: estado de la saga de reserva y retenciones provisionales (decisiones 1 y 3).
//   reservas.sagas_reserva
//       Una fila por compra (operación + Idempotency-Key): ordenId, estado, paso que falló, intentos y datos para el
//       barrido. Se crea en el esquema reservas, así la cubren los privilegios por defecto que 1793100000000 dio al rol.
//   disponibilidad.retenciones_cupos: columnas venceEn y confirmadaEn
//       Una retención de la saga nace provisional (venceEn) y deja de vencer al confirmarse. Las que ya existen quedan con
//       venceEn null: cuentan como confirmadas (se crearon dentro de la transacción de su orden). Índice parcial para que
//       el barrido de vencidas no lea la tabla entera.
// Sin claves foráneas: ordenId es una referencia lógica, como en el resto de módulos.
//
// Guardas: up() exige el esquema reservas, que la tabla de la saga no exista y que las columnas nuevas no existan.
// down() se niega si queda alguna saga sin terminar o alguna retención provisional (sin el vencimiento se quedaría
// retenida para siempre). Si algo no cuadra, no cambia nada y dice qué encontró.

const TERMINADAS = ['CONFIRMADA', 'COMPENSADA', 'FALLIDA'];

export class Fase84SagaReserva1793200000000 implements MigrationInterface {
  name = 'Fase84SagaReserva1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if ((await queryRunner.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'reservas'`)).length === 0) problemas.push('no existe el esquema reservas (lo crea 1793100000000)');
    const [{ existe }] = await queryRunner.query(`SELECT to_regclass('reservas.sagas_reserva') IS NOT NULL AS "existe"`);
    if (existe) problemas.push('ya existe reservas.sagas_reserva');
    const [{ retenciones }] = await queryRunner.query(`SELECT to_regclass('disponibilidad.retenciones_cupos') IS NOT NULL AS "retenciones"`);
    if (!retenciones) problemas.push('no está disponibilidad.retenciones_cupos (la mueve 1793000000000)');
    else if ((await this.columnas(queryRunner)).length > 0) problemas.push('disponibilidad.retenciones_cupos ya tiene venceEn o confirmadaEn');
    if (problemas.length > 0) throw new Error(`No se crea el estado de la saga:\n  ${problemas.join('\n  ')}`);

    await queryRunner.query(`ALTER TABLE "disponibilidad"."retenciones_cupos" ADD "venceEn" TIMESTAMP WITH TIME ZONE, ADD "confirmadaEn" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE INDEX "IDX_retenciones_cupos_vence" ON "disponibilidad"."retenciones_cupos" ("venceEn") WHERE "estado" = 'RETENIDA' AND "venceEn" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE TABLE "reservas"."sagas_reserva" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "ordenId" uuid NOT NULL,
      "operacion" character varying(30) NOT NULL,
      "claveIdempotencia" character varying(255) NOT NULL,
      "estado" character varying(25) NOT NULL DEFAULT 'INICIADA',
      "pasoFallido" character varying(25),
      "error" character varying(500),
      "intentos" integer NOT NULL DEFAULT 0,
      "datos" jsonb,
      "creadaEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "actualizadaEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_sagas_reserva" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_sagas_reserva_clave" UNIQUE ("operacion", "claveIdempotencia"),
      CONSTRAINT "CHK_sagas_reserva_estado" CHECK ("estado" IN ('INICIADA', 'CUPOS_RETENIDOS', 'ORDEN_CREADA', 'RETENCION_CONFIRMADA', 'CONFIRMADA', 'COMPENSANDO', 'COMPENSADA', 'FALLIDA'))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_sagas_reserva_orden" ON "reservas"."sagas_reserva" ("ordenId")`);
    await queryRunner.query(`CREATE INDEX "IDX_sagas_reserva_pendientes" ON "reservas"."sagas_reserva" ("estado", "actualizadaEn")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    const [{ existe }] = await queryRunner.query(`SELECT to_regclass('reservas.sagas_reserva') IS NOT NULL AS "existe"`);
    if (!existe) problemas.push('no está reservas.sagas_reserva');
    else {
      const [{ abiertas }] = await queryRunner.query(`SELECT count(*)::int AS "abiertas" FROM "reservas"."sagas_reserva" WHERE "estado" <> ALL($1)`, [TERMINADAS]);
      if (abiertas > 0) problemas.push(`hay ${abiertas} sagas sin terminar: espera a que el barrido las cierre`);
    }
    if ((await this.columnas(queryRunner)).length !== 2) problemas.push('a disponibilidad.retenciones_cupos le faltan venceEn o confirmadaEn');
    else {
      const [{ provisionales }] = await queryRunner.query(
        `SELECT count(*)::int AS "provisionales" FROM "disponibilidad"."retenciones_cupos" WHERE "estado" = 'RETENIDA' AND "venceEn" IS NOT NULL`,
      );
      if (provisionales > 0) problemas.push(`hay ${provisionales} retenciones provisionales: sin vencimiento quedarían retenidas para siempre`);
    }
    if (problemas.length > 0) throw new Error(`No se quita el estado de la saga:\n  ${problemas.join('\n  ')}`);

    await queryRunner.query(`DROP TABLE "reservas"."sagas_reserva"`);
    await queryRunner.query(`DROP INDEX "disponibilidad"."IDX_retenciones_cupos_vence"`);
    await queryRunner.query(`ALTER TABLE "disponibilidad"."retenciones_cupos" DROP COLUMN "confirmadaEn", DROP COLUMN "venceEn"`);
  }

  private async columnas(queryRunner: QueryRunner): Promise<string[]> {
    const filas: { column_name: string }[] = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'disponibilidad' AND table_name = 'retenciones_cupos' AND column_name IN ('venceEn', 'confirmadaEn')`,
    );
    return filas.map((f) => f.column_name);
  }
}
