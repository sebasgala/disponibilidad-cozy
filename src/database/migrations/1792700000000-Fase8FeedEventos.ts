import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8, feed de eventos con la opción A: cada dominio escribe sus eventos en su propia outbox, dentro de su transacción,
// y un único publicador (comun/v2/publicador-eventos.service.ts) les asigna el `sequence` global y los copia al feed.
//   outbox_usuarios (esquema usuarios), outbox_catalogo, outbox_disponibilidad, outbox_reservas (public, por ahora)
//   outbox_eventos  -> feed_eventos, con sus columnas, índices y `sequence` como PK; los eventos ya publicados no cambian
//   feed_publicador fila única con el último `sequence` publicado; reemplaza a evento_secuencia
// Las outbox empiezan vacías: el historial ya está en el feed con su número.

const TIPOS_RESERVAS = ['alojamiento.reserva.confirmada', 'alojamiento.reserva.cancelada', 'alojamiento.checkin.completado', 'alojamiento.checkout.completado'];
const TIPOS_DISPONIBILIDAD = ['alojamiento.stock.actualizado'];

// [esquema, tabla, tipos permitidos (null: el dominio todavía no tiene eventos)]
const OUTBOX: [string, string, string[] | null][] = [
  ['usuarios', 'outbox_usuarios', null],
  ['public', 'outbox_catalogo', null],
  ['public', 'outbox_disponibilidad', TIPOS_DISPONIBILIDAD],
  ['public', 'outbox_reservas', TIPOS_RESERVAS],
];

const RENOMBRES: [string, string][] = [
  ['PK_outbox_eventos', 'PK_feed_eventos'],
  ['UQ_outbox_eventos_id', 'UQ_feed_eventos_id'],
  ['CHK_outbox_eventos_sequence', 'CHK_feed_eventos_sequence'],
  ['CHK_outbox_eventos_tipo', 'CHK_feed_eventos_tipo'],
];
const INDICES: [string, string][] = [
  ['IX_outbox_eventos_tipo', 'IX_feed_eventos_tipo'],
  ['IX_outbox_eventos_alojamientoId', 'IX_feed_eventos_alojamientoId'],
];

export class Fase8FeedEventos1792700000000 implements MigrationInterface {
  name = 'Fase8FeedEventos1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [esquema, tabla, tipos] of OUTBOX) {
      await queryRunner.query(`
        CREATE TABLE "${esquema}"."${tabla}" (
          "id" bigserial NOT NULL,
          "eventoId" uuid NOT NULL,
          "tipo" varchar(60) NOT NULL,
          "sujeto" varchar(200) NOT NULL,
          "alojamientoId" integer,
          "correlacionId" varchar(64),
          "datos" jsonb NOT NULL,
          "creadoEn" timestamptz NOT NULL DEFAULT now(),
          "registradoEn" timestamptz NOT NULL DEFAULT clock_timestamp(),
          "sequence" bigint,
          CONSTRAINT "PK_${tabla}" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_${tabla}_eventoId" UNIQUE ("eventoId"),
          CONSTRAINT "CHK_${tabla}_sequence" CHECK ("sequence" IS NULL OR "sequence" >= 1)
          ${tipos ? `, CONSTRAINT "CHK_${tabla}_tipo" CHECK ("tipo" IN (${tipos.map((t) => `'${t}'`).join(', ')}))` : ''}
        )
      `);
      // Lo que el publicador busca en cada pasada: lo pendiente, en orden de registro
      await queryRunner.query(`CREATE INDEX "IX_${tabla}_pendientes" ON "${esquema}"."${tabla}" ("registradoEn", "id") WHERE "sequence" IS NULL`);
    }

    await queryRunner.query(`ALTER TABLE "outbox_eventos" RENAME TO "feed_eventos"`);
    for (const [viejo, nuevo] of RENOMBRES) await queryRunner.query(`ALTER TABLE "feed_eventos" RENAME CONSTRAINT "${viejo}" TO "${nuevo}"`);
    for (const [viejo, nuevo] of INDICES) await queryRunner.query(`ALTER INDEX "${viejo}" RENAME TO "${nuevo}"`);

    await queryRunner.query(`
      CREATE TABLE "feed_publicador" (
        "id" integer NOT NULL,
        "ultimo" bigint NOT NULL,
        CONSTRAINT "PK_feed_publicador" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_feed_publicador_unica" CHECK ("id" = 1),
        CONSTRAINT "CHK_feed_publicador_ultimo" CHECK ("ultimo" >= 0)
      )
    `);
    // El contador y el feed deben coincidir; si no, algo está mal y no se sigue
    const [estado] = await queryRunner.query(`
      SELECT (SELECT "ultimo" FROM "evento_secuencia" WHERE "id" = 1)::bigint AS "contador",
             (SELECT coalesce(max("sequence"), 0) FROM "feed_eventos")::bigint AS "maximo",
             (SELECT count(*) FROM "feed_eventos")::bigint AS "filas"
    `);
    if (String(estado.contador) !== String(estado.maximo) || String(estado.maximo) !== String(estado.filas)) {
      throw new Error(`evento_secuencia (${estado.contador}), el máximo del feed (${estado.maximo}) y sus filas (${estado.filas}) no coinciden`);
    }
    await queryRunner.query(`INSERT INTO "feed_publicador" ("id", "ultimo") VALUES (1, $1)`, [estado.maximo]);
    await queryRunner.query(`DROP TABLE "evento_secuencia"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Lo que quede pendiente en las outbox no tiene a dónde volver: se avisa en vez de perderlo en silencio
    for (const [esquema, tabla] of OUTBOX) {
      const [{ n }] = await queryRunner.query(`SELECT count(*)::int AS "n" FROM "${esquema}"."${tabla}" WHERE "sequence" IS NULL`);
      if (n > 0) throw new Error(`${esquema}.${tabla} tiene ${n} eventos sin publicar: publícalos antes de deshacer`);
    }
    await queryRunner.query(`
      CREATE TABLE "evento_secuencia" (
        "id" integer NOT NULL,
        "ultimo" bigint NOT NULL,
        CONSTRAINT "PK_evento_secuencia" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_evento_secuencia_unica" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(`INSERT INTO "evento_secuencia" ("id", "ultimo") SELECT 1, coalesce(max("sequence"), 0) FROM "feed_eventos"`);
    await queryRunner.query(`DROP TABLE "feed_publicador"`);
    for (const [viejo, nuevo] of INDICES) await queryRunner.query(`ALTER INDEX "${nuevo}" RENAME TO "${viejo}"`);
    for (const [viejo, nuevo] of RENOMBRES) await queryRunner.query(`ALTER TABLE "feed_eventos" RENAME CONSTRAINT "${nuevo}" TO "${viejo}"`);
    await queryRunner.query(`ALTER TABLE "feed_eventos" RENAME TO "outbox_eventos"`);
    for (const [esquema, tabla] of [...OUTBOX].reverse()) await queryRunner.query(`DROP TABLE "${esquema}"."${tabla}"`);
  }
}
