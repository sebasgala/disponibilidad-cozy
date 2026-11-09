import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 9.0 (E1): las tablas que seguían en public y compartían varios módulos pasan a un esquema con un solo dueño.
//   auditoria_cambios → una tabla por módulo: usuarios.auditoria_usuarios, catalogo.auditoria_catalogo,
//       disponibilidad.auditoria_disponibilidad y reservas.auditoria_reservas. Cada fila va al módulo de su `entidad`
//       (REPARTO, abajo); la alerta de bajas con reservas vigentes la escribe disponibilidad. Los ids se conservan. Cada tabla
//       tiene su secuencia, que sigue después del último id copiado (CORTE, guardado en el comentario de cada tabla).
//   eventos_dominio → catalogo.eventos_catalogo (ALTER TABLE … SET SCHEMA y RENAME: no se copia ninguna fila). La escribe solo el
//       catálogo. Disponibilidad, su único consumidor, deja de marcar `procesadoEn` en la tabla del catálogo: guarda lo que ya
//       procesó en disponibilidad.eventos_catalogo_procesados, que se rellena con los eventos que tenían `procesadoEn`.
//       `procesadoEn` se queda en la tabla (con su valor) pero ya no se escribe.
//   feed_eventos y feed_publicador → esquema nuevo comun, del publicador del feed (ALTER TABLE … SET SCHEMA).
//   migraciones se queda en public: es la tabla de TypeORM y solo la usa quien ejecuta las migraciones (postgres).
// Permisos:
//   comun          USAGE y lectura y escritura en su esquema; lee las cuatro outbox de dominio y solo puede actualizar su columna
//                  "sequence" (el publicador único del feed, opción A de la fase 8). Pierde el USAGE sobre public.
//   disponibilidad USAGE sobre catalogo y SELECT sobre catalogo.eventos_catalogo, nada más del catálogo.
//   cada módulo    lee y escribe su tabla de auditoría (ya lo cubren los privilegios por defecto de su esquema; se repite explícito).
//   public         sin USAGE para ningún rol de módulo.
//
// Guardas, como en 8.2 a 8.4. up() exige: que no exista el esquema comun ni ninguna tabla nueva; que las cuatro tablas estén en
// public; que existan los cinco roles; y que TODA fila de auditoría tenga un módulo (si hay una entidad sin dueño, se niega y la
// nombra). Comprueba que se copiaron todas las filas antes de borrar la tabla vieja. down() exige lo mismo al revés: que ninguna
// tabla vieja esté ya en public, que cada tabla de auditoría tenga su CORTE y que los ids hasta el CORTE no se repitan entre las
// cuatro. down() NO borra filas: las de auditoría vuelven a public.auditoria_cambios (las de antes de up() con su id; las creadas
// después, con un id nuevo de la secuencia restaurada, en el orden en que se crearon) y lo procesado vuelve a `procesadoEn`.
// Si algo no cuadra, no cambia nada y dice qué encontró. DROP SCHEMA es RESTRICT.

export const MODULOS_AUDITORIA = ['usuarios', 'catalogo', 'disponibilidad', 'reservas'] as const;
export const ACCION_ALERTA_BAJA = 'baja_con_reservas_vigentes';
const REPARTO: Record<string, (typeof MODULOS_AUDITORIA)[number]> = {
  usuario: 'usuarios',
  ciudad: 'catalogo',
  alojamiento: 'catalogo',
  habitacion: 'catalogo',
  disponibilidad: 'disponibilidad',
  plan_tarifa: 'disponibilidad',
  restricciones: 'disponibilidad',
  orden: 'reservas',
};
const ROLES = ['usuarios', 'catalogo', 'disponibilidad', 'reservas', 'comun'];
const OUTBOX = [
  ['usuarios', 'outbox_usuarios'],
  ['catalogo', 'outbox_catalogo'],
  ['disponibilidad', 'outbox_disponibilidad'],
  ['reservas', 'outbox_reservas'],
];
const MARCA_CORTE = 'Fase 9.0 (E1): las filas con id <= ';
const tablaAuditoria = (m: string) => `"${m}"."auditoria_${m}"`;

// La expresión SQL que da el módulo de una fila de auditoría (NULL si no tiene)
const MODULO_DE_FILA = `CASE WHEN "accion" = '${ACCION_ALERTA_BAJA}' THEN 'disponibilidad' ${Object.entries(REPARTO)
  .map(([entidad, modulo]) => `WHEN "entidad" = '${entidad}' THEN '${modulo}'`)
  .join(' ')} END`;

export class Fase9TablasCompartidas1793300000000 implements MigrationInterface {
  name = 'Fase9TablasCompartidas1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if (await this.existeEsquema(queryRunner, 'comun')) problemas.push('el esquema comun ya existe');
    for (const t of ['auditoria_cambios', 'eventos_dominio', 'feed_eventos', 'feed_publicador']) {
      if (!(await this.existe(queryRunner, `public.${t}`))) problemas.push(`no está public.${t}`);
    }
    for (const m of MODULOS_AUDITORIA) {
      if (!(await this.existeEsquema(queryRunner, m))) problemas.push(`no existe el esquema ${m}`);
      else if (await this.existe(queryRunner, `${m}.auditoria_${m}`)) problemas.push(`ya existe ${m}.auditoria_${m}`);
    }
    if (await this.existe(queryRunner, 'catalogo.eventos_catalogo')) problemas.push('ya existe catalogo.eventos_catalogo');
    if (await this.existe(queryRunner, 'disponibilidad.eventos_catalogo_procesados')) problemas.push('ya existe disponibilidad.eventos_catalogo_procesados');
    for (const [esquema, t] of OUTBOX) if (!(await this.existe(queryRunner, `${esquema}.${t}`))) problemas.push(`no está ${esquema}.${t}`);
    for (const rol of ROLES) {
      if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol])).length === 0) problemas.push(`no existe el rol ${rol} (lo crea 1792810000000-Fase82RolesPorModulo)`);
    }
    if (problemas.length === 0) {
      const sinDueno: { entidad: string; accion: string; filas: number }[] = await queryRunner.query(
        `SELECT "entidad", "accion", count(*)::int AS "filas" FROM "public"."auditoria_cambios" WHERE (${MODULO_DE_FILA}) IS NULL GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      for (const s of sinDueno) problemas.push(`${s.filas} filas de auditoría sin módulo (entidad '${s.entidad}', accion '${s.accion}'): añade la entidad a REPARTO`);
    }
    if (problemas.length > 0) throw new Error(`No se mueven las tablas compartidas a su esquema:\n  ${problemas.join('\n  ')}`);

    // 1. Auditoría: una tabla por módulo, con las filas de su módulo y su propia secuencia después del CORTE
    const [{ total, corte }] = await queryRunner.query(
      `SELECT count(*)::int AS "total", greatest(coalesce(max("id"), 0), (SELECT last_value FROM "public"."auditoria_cambios_id_seq"))::bigint AS "corte" FROM "public"."auditoria_cambios"`,
    );
    for (const m of MODULOS_AUDITORIA) {
      await this.crearAuditoria(queryRunner, m, `auditoria_${m}`, `PK_auditoria_${m}`, `IX_auditoria_${m}`);
      await queryRunner.query(
        `INSERT INTO ${tablaAuditoria(m)} ("id", "usuarioId", "accion", "entidad", "entidadId", "antes", "despues", "createdAt")
         SELECT "id", "usuarioId", "accion", "entidad", "entidadId", "antes", "despues", "createdAt" FROM "public"."auditoria_cambios"
         WHERE (${MODULO_DE_FILA}) = $1 ORDER BY "id"`,
        [m],
      );
      await queryRunner.query(`SELECT setval(pg_get_serial_sequence('${m}.auditoria_${m}', 'id'), $1::bigint, true)`, [Math.max(Number(corte), 1)]);
      await queryRunner.query(`COMMENT ON TABLE ${tablaAuditoria(m)} IS '${MARCA_CORTE}${corte} vienen de public.auditoria_cambios'`);
    }
    const copiadas = await this.contarAuditoria(queryRunner);
    if (copiadas !== total) throw new Error(`Se copiaron ${copiadas} filas de auditoría de ${total}: no se borra public.auditoria_cambios`);
    await queryRunner.query(`DROP TABLE "public"."auditoria_cambios"`);

    // 2. Eventos del catálogo: la tabla pasa al catálogo; lo procesado, a disponibilidad
    await queryRunner.query(`ALTER TABLE "public"."eventos_dominio" SET SCHEMA "catalogo"`);
    await queryRunner.query(`ALTER TABLE "catalogo"."eventos_dominio" RENAME TO "eventos_catalogo"`);
    await queryRunner.query(`ALTER SEQUENCE "catalogo"."eventos_dominio_id_seq" RENAME TO "eventos_catalogo_id_seq"`);
    await queryRunner.query(`ALTER INDEX "catalogo"."PK_eventos_dominio" RENAME TO "PK_eventos_catalogo"`);
    await queryRunner.query(`ALTER INDEX "catalogo"."IDX_eventos_dominio_pendientes" RENAME TO "IDX_eventos_catalogo_pendientes"`);
    await queryRunner.query(
      `CREATE TABLE "disponibilidad"."eventos_catalogo_procesados" (
         "eventoId" bigint NOT NULL,
         "procesadoEn" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "PK_eventos_catalogo_procesados" PRIMARY KEY ("eventoId"))`,
    );
    await queryRunner.query(
      `INSERT INTO "disponibilidad"."eventos_catalogo_procesados" ("eventoId", "procesadoEn")
       SELECT "id", "procesadoEn" FROM "catalogo"."eventos_catalogo" WHERE "procesadoEn" IS NOT NULL`,
    );

    // 3. Feed: esquema comun
    await queryRunner.query(`CREATE SCHEMA "comun"`);
    await queryRunner.query(`ALTER TABLE "public"."feed_eventos" SET SCHEMA "comun"`);
    await queryRunner.query(`ALTER TABLE "public"."feed_publicador" SET SCHEMA "comun"`);

    // 4. Permisos
    await queryRunner.query(`GRANT USAGE ON SCHEMA "comun" TO "comun"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "comun" TO "comun"`);
    await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "comun" TO "comun"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "comun" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "comun"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "comun" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "comun"`);
    for (const [esquema, t] of OUTBOX) {
      await queryRunner.query(`GRANT USAGE ON SCHEMA "${esquema}" TO "comun"`);
      await queryRunner.query(`GRANT SELECT, UPDATE ("sequence") ON "${esquema}"."${t}" TO "comun"`);
    }
    await queryRunner.query(`GRANT USAGE ON SCHEMA "catalogo" TO "disponibilidad"`);
    await queryRunner.query(`GRANT SELECT ON "catalogo"."eventos_catalogo" TO "disponibilidad"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "catalogo"."eventos_catalogo" TO "catalogo"`);
    await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE "catalogo"."eventos_catalogo_id_seq" TO "catalogo"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "disponibilidad"."eventos_catalogo_procesados" TO "disponibilidad"`);
    for (const m of MODULOS_AUDITORIA) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tablaAuditoria(m)} TO "${m}"`);
      await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE "${m}"."auditoria_${m}_id_seq" TO "${m}"`);
    }
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM "comun"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if (!(await this.existeEsquema(queryRunner, 'comun'))) problemas.push('no existe el esquema comun');
    for (const t of ['auditoria_cambios', 'eventos_dominio', 'feed_eventos', 'feed_publicador']) {
      if (await this.existe(queryRunner, `public.${t}`)) problemas.push(`ya existe public.${t}`);
    }
    for (const t of ['comun.feed_eventos', 'comun.feed_publicador', 'catalogo.eventos_catalogo', 'disponibilidad.eventos_catalogo_procesados']) {
      if (!(await this.existe(queryRunner, t))) problemas.push(`no está ${t}`);
    }
    const otrasEnComun: { relname: string }[] = await queryRunner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'comun' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname NOT IN ('feed_eventos', 'feed_publicador')`,
    );
    if (otrasEnComun.length > 0) problemas.push(`en comun hay otras tablas o vistas: ${otrasEnComun.map((o) => o.relname).join(', ')}`);
    let corte: number | null = null;
    for (const m of MODULOS_AUDITORIA) {
      if (!(await this.existe(queryRunner, `${m}.auditoria_${m}`))) {
        problemas.push(`no está ${m}.auditoria_${m}`);
        continue;
      }
      const [{ comentario }] = await queryRunner.query(`SELECT obj_description($1::regclass, 'pg_class') AS "comentario"`, [`${m}.auditoria_${m}`]);
      const valor = typeof comentario === 'string' && comentario.startsWith(MARCA_CORTE) ? Number(comentario.slice(MARCA_CORTE.length).split(' ')[0]) : NaN;
      if (!Number.isInteger(valor)) problemas.push(`${m}.auditoria_${m} no tiene el comentario con el CORTE: no se sabe qué ids conservar`);
      else if (corte !== null && corte !== valor) problemas.push(`los CORTES no coinciden (${corte} y ${valor} en ${m}.auditoria_${m})`);
      else corte = valor;
    }
    if (problemas.length === 0) {
      const union = MODULOS_AUDITORIA.map((m) => `SELECT "id" FROM ${tablaAuditoria(m)} WHERE "id" <= $1`).join(' UNION ALL ');
      const repetidos: { id: string }[] = await queryRunner.query(`SELECT "id" FROM (${union}) u GROUP BY "id" HAVING count(*) > 1 LIMIT 5`, [corte]);
      if (repetidos.length > 0) problemas.push(`ids de auditoría hasta el CORTE repetidos entre módulos (${repetidos.map((r) => r.id).join(', ')}): no se pueden devolver con su id`);
    }
    if (problemas.length > 0) throw new Error(`No se devuelven las tablas compartidas a public:\n  ${problemas.join('\n  ')}`);

    // 4. Permisos, al revés
    await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "comun"`);
    for (const m of MODULOS_AUDITORIA) await queryRunner.query(`REVOKE ALL ON ${tablaAuditoria(m)} FROM "${m}"`);
    await queryRunner.query(`REVOKE ALL ON "disponibilidad"."eventos_catalogo_procesados" FROM "disponibilidad"`);
    await queryRunner.query(`REVOKE ALL ON "catalogo"."eventos_catalogo" FROM "disponibilidad"`);
    await queryRunner.query(`REVOKE ALL ON "catalogo"."eventos_catalogo" FROM "catalogo"`);
    await queryRunner.query(`REVOKE ALL ON SEQUENCE "catalogo"."eventos_catalogo_id_seq" FROM "catalogo"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "catalogo" FROM "disponibilidad"`);
    for (const [esquema, t] of OUTBOX) {
      await queryRunner.query(`REVOKE ALL ("sequence") ON "${esquema}"."${t}" FROM "comun"`);
      await queryRunner.query(`REVOKE ALL ON "${esquema}"."${t}" FROM "comun"`);
      await queryRunner.query(`REVOKE USAGE ON SCHEMA "${esquema}" FROM "comun"`);
    }
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "comun" REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM "comun"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "comun" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "comun"`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "comun" FROM "comun"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "comun" FROM "comun"`);

    // 3. Feed a public
    await queryRunner.query(`ALTER TABLE "comun"."feed_publicador" SET SCHEMA "public"`);
    await queryRunner.query(`ALTER TABLE "comun"."feed_eventos" SET SCHEMA "public"`);
    await queryRunner.query(`DROP SCHEMA "comun" RESTRICT`);

    // 2. Eventos del catálogo: lo procesado vuelve a procesadoEn y la tabla, a public
    await queryRunner.query(
      `UPDATE "catalogo"."eventos_catalogo" e SET "procesadoEn" = p."procesadoEn"
       FROM "disponibilidad"."eventos_catalogo_procesados" p WHERE p."eventoId" = e."id" AND e."procesadoEn" IS NULL`,
    );
    const [{ sinEvento }] = await queryRunner.query(
      `SELECT count(*)::int AS "sinEvento" FROM "disponibilidad"."eventos_catalogo_procesados" p
       WHERE NOT EXISTS (SELECT 1 FROM "catalogo"."eventos_catalogo" e WHERE e."id" = p."eventoId")`,
    );
    if (sinEvento > 0) throw new Error(`${sinEvento} eventos procesados no están en catalogo.eventos_catalogo: no se borra lo procesado`);
    await queryRunner.query(`DROP TABLE "disponibilidad"."eventos_catalogo_procesados"`);
    await queryRunner.query(`ALTER INDEX "catalogo"."IDX_eventos_catalogo_pendientes" RENAME TO "IDX_eventos_dominio_pendientes"`);
    await queryRunner.query(`ALTER INDEX "catalogo"."PK_eventos_catalogo" RENAME TO "PK_eventos_dominio"`);
    await queryRunner.query(`ALTER SEQUENCE "catalogo"."eventos_catalogo_id_seq" RENAME TO "eventos_dominio_id_seq"`);
    await queryRunner.query(`ALTER TABLE "catalogo"."eventos_catalogo" RENAME TO "eventos_dominio"`);
    await queryRunner.query(`ALTER TABLE "catalogo"."eventos_dominio" SET SCHEMA "public"`);

    // 1. Auditoría: una sola tabla en public, como la creó 1786000000000 (mismos nombres de clave e índices)
    const total = await this.contarAuditoria(queryRunner);
    await this.crearAuditoria(queryRunner, 'public', 'auditoria_cambios', 'PK_1baf22c06cf3c35dd1076cf7320', 'IX_auditoria');
    const todas = MODULOS_AUDITORIA.map((m) => `SELECT * FROM ${tablaAuditoria(m)}`).join(' UNION ALL ');
    await queryRunner.query(
      `INSERT INTO "public"."auditoria_cambios" ("id", "usuarioId", "accion", "entidad", "entidadId", "antes", "despues", "createdAt")
       SELECT "id", "usuarioId", "accion", "entidad", "entidadId", "antes", "despues", "createdAt" FROM (${todas}) t WHERE "id" <= $1 ORDER BY "id"`,
      [corte],
    );
    await queryRunner.query(`SELECT setval('"public"."auditoria_cambios_id_seq"', $1::bigint, true)`, [Math.max(corte!, 1)]);
    await queryRunner.query(
      `INSERT INTO "public"."auditoria_cambios" ("usuarioId", "accion", "entidad", "entidadId", "antes", "despues", "createdAt")
       SELECT "usuarioId", "accion", "entidad", "entidadId", "antes", "despues", "createdAt" FROM (${todas}) t WHERE "id" > $1 ORDER BY "createdAt", "id"`,
      [corte],
    );
    const [{ devueltas }] = await queryRunner.query(`SELECT count(*)::int AS "devueltas" FROM "public"."auditoria_cambios"`);
    if (devueltas !== total) throw new Error(`Se devolvieron ${devueltas} filas de auditoría de ${total}: no se borran las tablas por módulo`);
    for (const m of MODULOS_AUDITORIA) await queryRunner.query(`DROP TABLE ${tablaAuditoria(m)}`);
  }

  private async crearAuditoria(queryRunner: QueryRunner, esquema: string, tabla: string, pk: string, prefijoIndice: string): Promise<void> {
    const t = `"${esquema}"."${tabla}"`;
    await queryRunner.query(
      `CREATE TABLE ${t} (
         "id" bigserial NOT NULL,
         "usuarioId" uuid,
         "accion" character varying(60) NOT NULL,
         "entidad" character varying(60) NOT NULL,
         "entidadId" character varying(120) NOT NULL,
         "antes" jsonb,
         "despues" jsonb,
         "createdAt" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "${pk}" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "${prefijoIndice}_entidad" ON ${t} ("entidad", "entidadId")`);
    await queryRunner.query(`CREATE INDEX "${prefijoIndice}_usuarioId" ON ${t} ("usuarioId")`);
    await queryRunner.query(`CREATE INDEX "${prefijoIndice}_createdAt" ON ${t} ("createdAt")`);
  }

  private async contarAuditoria(queryRunner: QueryRunner): Promise<number> {
    const [{ n }] = await queryRunner.query(`SELECT (${MODULOS_AUDITORIA.map((m) => `(SELECT count(*) FROM ${tablaAuditoria(m)})`).join(' + ')})::int AS "n"`);
    return n;
  }

  private async existe(queryRunner: QueryRunner, nombre: string): Promise<boolean> {
    const [{ existe }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe"`, [nombre]);
    return existe;
  }

  private async existeEsquema(queryRunner: QueryRunner, esquema: string): Promise<boolean> {
    return (await queryRunner.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [esquema])).length > 0;
  }
}
