import { MigrationInterface, QueryRunner } from 'typeorm';

// Integración v2 (fase 2): los datos que el contrato alojamientos-openapi-v2 pide del catálogo y la ficha.
// Es aditiva: no se borra ni se renombra nada de lo que usa la v1.
//   alojamientos: código público (HTL-<NODO>-<CIUDAD>-<NNN>), estrellas, tipo de propiedad, dirección, coordenadas
//                 y horas de check-in / check-out.
//   habitaciones: código del tipo de habitación (SUITE_DELUXE, único por alojamiento), descripción, camas, m²,
//                 fotos y amenidades.
// Los códigos de las filas existentes se calculan aquí; las nuevas los generan los servicios (codigos.ts).
const TIPOS_PROPIEDAD = ['HOTEL', 'RESORT', 'APARTAMENTO', 'HOSTAL', 'HOSTERIA'];
const HORA = `'^([01][0-9]|2[0-3]):[0-5][0-9]$'`;
const CON_ACENTOS = 'áéíóúüñÁÉÍÓÚÜÑ';
const SIN_ACENTOS = 'aeiouunAEIOUUN';

export class ContratoV2Catalogo1792000000000 implements MigrationInterface {
  name = 'ContratoV2Catalogo1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const nodo = (process.env.NODO_CODIGO ?? 'COZY').toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'COZY';

    await queryRunner.query(`
      ALTER TABLE "alojamientos"
        ADD "codigo" character varying(64),
        ADD "estrellas" smallint NOT NULL DEFAULT 3,
        ADD "tipoPropiedad" character varying(20) NOT NULL DEFAULT 'HOTEL',
        ADD "direccion" character varying(255),
        ADD "latitud" numeric(9,6),
        ADD "longitud" numeric(9,6),
        ADD "checkInDesde" character varying(5) NOT NULL DEFAULT '14:00',
        ADD "checkOutMaxima" character varying(5) NOT NULL DEFAULT '11:00'
    `);

    // HTL-<NODO>-<3 letras de la ciudad>-<id con al menos 3 dígitos>
    await queryRunner.query(
      `
      UPDATE "alojamientos" a
      SET "codigo" = 'HTL-' || $1 || '-' ||
        rpad(upper(left(regexp_replace(translate(COALESCE(c."nombre", a."destino"), '${CON_ACENTOS}', '${SIN_ACENTOS}'), '[^A-Za-z]', '', 'g'), 3)), 3, 'X')
        || '-' || lpad(a."id"::text, 3, '0')
      FROM "alojamientos" x LEFT JOIN "ciudades" c ON c."id" = x."ciudadId"
      WHERE a."id" = x."id"
    `,
      [nodo],
    );
    await queryRunner.query(`ALTER TABLE "alojamientos" ALTER COLUMN "codigo" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "alojamientos" ADD CONSTRAINT "UQ_alojamientos_codigo" UNIQUE ("codigo")`);
    await queryRunner.query(`ALTER TABLE "alojamientos" ADD CONSTRAINT "CHK_alojamientos_estrellas" CHECK ("estrellas" BETWEEN 1 AND 5)`);
    await queryRunner.query(
      `ALTER TABLE "alojamientos" ADD CONSTRAINT "CHK_alojamientos_tipo_propiedad" CHECK ("tipoPropiedad" IN (${TIPOS_PROPIEDAD.map((t) => `'${t}'`).join(', ')}))`,
    );
    await queryRunner.query(
      `ALTER TABLE "alojamientos" ADD CONSTRAINT "CHK_alojamientos_coordenadas" CHECK (("latitud" IS NULL OR "latitud" BETWEEN -90 AND 90) AND ("longitud" IS NULL OR "longitud" BETWEEN -180 AND 180))`,
    );
    await queryRunner.query(
      `ALTER TABLE "alojamientos" ADD CONSTRAINT "CHK_alojamientos_horas" CHECK ("checkInDesde" ~ ${HORA} AND "checkOutMaxima" ~ ${HORA})`,
    );

    await queryRunner.query(`
      ALTER TABLE "habitaciones"
        ADD "codigo" character varying(40),
        ADD "descripcion" text,
        ADD "camas" character varying(100),
        ADD "metrosCuadrados" integer,
        ADD "fotos" jsonb,
        ADD "amenidades" jsonb
    `);

    // Código del tipo de habitación: el nombre en MAYÚSCULAS con guion bajo ("Suite Deluxe" => SUITE_DELUXE).
    // Si dos habitaciones de un mismo alojamiento dan el mismo código, la segunda lleva _2, la tercera _3, etc.
    await queryRunner.query(`
      WITH limpia AS (
        SELECT "id", "alojamientoId",
          upper(trim(both '_' from regexp_replace(translate("nombre", '${CON_ACENTOS}', '${SIN_ACENTOS}'), '[^A-Za-z0-9]+', '_', 'g'))) AS x
        FROM "habitaciones"
      ), base AS (
        SELECT "id", "alojamientoId", CASE WHEN length(x) >= 2 THEN left(x, 36) ELSE rpad(x, 2, 'X') END AS b FROM limpia
      ), numerada AS (
        SELECT "id", b, row_number() OVER (PARTITION BY "alojamientoId", b ORDER BY "id") AS n FROM base
      )
      UPDATE "habitaciones" h
      SET "codigo" = CASE WHEN numerada.n = 1 THEN numerada.b ELSE numerada.b || '_' || numerada.n END
      FROM numerada WHERE h."id" = numerada."id"
    `);
    await queryRunner.query(`ALTER TABLE "habitaciones" ALTER COLUMN "codigo" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "habitaciones" ADD CONSTRAINT "UQ_habitaciones_alojamiento_codigo" UNIQUE ("alojamientoId", "codigo")`,
    );
    await queryRunner.query(`ALTER TABLE "habitaciones" ADD CONSTRAINT "CHK_habitaciones_codigo" CHECK ("codigo" ~ '^[A-Z0-9_]{2,40}$')`);
    await queryRunner.query(`ALTER TABLE "habitaciones" ADD CONSTRAINT "CHK_habitaciones_metros" CHECK ("metrosCuadrados" IS NULL OR "metrosCuadrados" > 0)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "habitaciones" DROP CONSTRAINT "CHK_habitaciones_metros"`);
    await queryRunner.query(`ALTER TABLE "habitaciones" DROP CONSTRAINT "CHK_habitaciones_codigo"`);
    await queryRunner.query(`ALTER TABLE "habitaciones" DROP CONSTRAINT "UQ_habitaciones_alojamiento_codigo"`);
    await queryRunner.query(
      `ALTER TABLE "habitaciones" DROP COLUMN "amenidades", DROP COLUMN "fotos", DROP COLUMN "metrosCuadrados", DROP COLUMN "camas", DROP COLUMN "descripcion", DROP COLUMN "codigo"`,
    );
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "CHK_alojamientos_horas"`);
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "CHK_alojamientos_coordenadas"`);
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "CHK_alojamientos_tipo_propiedad"`);
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "CHK_alojamientos_estrellas"`);
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "UQ_alojamientos_codigo"`);
    await queryRunner.query(
      `ALTER TABLE "alojamientos" DROP COLUMN "checkOutMaxima", DROP COLUMN "checkInDesde", DROP COLUMN "longitud", DROP COLUMN "latitud", DROP COLUMN "direccion", DROP COLUMN "tipoPropiedad", DROP COLUMN "estrellas", DROP COLUMN "codigo"`,
    );
  }
}
