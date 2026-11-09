import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.2, paso 3 (D5 y D7): el catálogo tiene su propio esquema.
//   catalogo.ciudades, catalogo.alojamientos, catalogo.habitaciones, catalogo.outbox_catalogo
//       Las cuatro tablas pasan de public a catalogo con ALTER TABLE … SET SCHEMA: no se borra ni se copia ninguna fila.
//       Con cada tabla se mueven sus índices, sus restricciones (incluidas las 2 claves foráneas internas del catálogo)
//       y sus secuencias propias (ciudades_id_seq, alojamientos_id_seq, outbox_catalogo_id_seq). No tienen tipos enum.
//   rol catalogo
//       USAGE sobre su esquema; leer y escribir sus tablas y usar sus secuencias, también las que se creen después.
//       Nada sobre otros esquemas: se quita a PUBLIC el USAGE sobre public (en PostgreSQL 16 todo rol lo heredaba) y se
//       devuelve solo a los roles cuyos módulos todavía tienen tablas en public: disponibilidad, reservas y comun.
// La aplicación sigue conectándose como postgres (superusuario): los permisos no la afectan.
//
// Guardas, como en el paso 2: up() exige que las tablas estén en public, que el esquema no exista, que los roles
// existan y que ninguna clave foránea entre a estas tablas desde fuera del catálogo (las quitó el paso 2). down()
// exige lo mismo al revés y que en catalogo no haya nada más; si algo no cuadra, no cambia nada y dice qué encontró.

export const ESQUEMA_CATALOGO = 'catalogo';
export const TABLAS_CATALOGO = ['ciudades', 'alojamientos', 'habitaciones', 'outbox_catalogo'];
const ROL = 'catalogo';
const CON_TABLAS_EN_PUBLIC = ['disponibilidad', 'reservas', 'comun'];
const LISTA = TABLAS_CATALOGO.map((t) => `'${t}'`).join(', ');

export class Fase82EsquemaCatalogo1792900000000 implements MigrationInterface {
  name = 'Fase82EsquemaCatalogo1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if ((await queryRunner.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [ESQUEMA_CATALOGO])).length > 0) problemas.push(`el esquema ${ESQUEMA_CATALOGO} ya existe`);
    for (const t of TABLAS_CATALOGO) {
      const [{ existe }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe"`, [`public.${t}`]);
      if (!existe) problemas.push(`no está public.${t}`);
    }
    for (const rol of [ROL, ...CON_TABLAS_EN_PUBLIC]) {
      if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol])).length === 0) problemas.push(`no existe el rol ${rol} (lo crea 1792810000000-Fase82RolesPorModulo)`);
    }
    if (problemas.length === 0) problemas.push(...(await this.fkQueEntran(queryRunner, 'public')));
    if (problemas.length > 0) throw new Error(`No se mueve el catálogo a su esquema:\n  ${problemas.join('\n  ')}`);

    await queryRunner.query(`CREATE SCHEMA "${ESQUEMA_CATALOGO}"`);
    for (const t of TABLAS_CATALOGO) await queryRunner.query(`ALTER TABLE "public"."${t}" SET SCHEMA "${ESQUEMA_CATALOGO}"`);

    // Permisos del rol catalogo: solo su esquema
    await queryRunner.query(`GRANT USAGE ON SCHEMA "${ESQUEMA_CATALOGO}" TO "${ROL}"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${ESQUEMA_CATALOGO}" TO "${ROL}"`);
    await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${ESQUEMA_CATALOGO}" TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_CATALOGO}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_CATALOGO}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${ROL}"`);
    // Y nada fuera de él: public deja de estar abierto a todos los roles
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM PUBLIC`);
    for (const rol of CON_TABLAS_EN_PUBLIC) await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "${rol}"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    for (const t of TABLAS_CATALOGO) {
      const [{ existe, ocupado }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe", to_regclass($2) IS NOT NULL AS "ocupado"`, [`${ESQUEMA_CATALOGO}.${t}`, `public.${t}`]);
      if (!existe) problemas.push(`no está ${ESQUEMA_CATALOGO}.${t}`);
      if (ocupado) problemas.push(`ya existe public.${t}`);
    }
    // En el esquema solo pueden estar las 4 tablas (sus secuencias e índices van con ellas)
    const otras: { relname: string }[] = await queryRunner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname NOT IN (${LISTA})`,
      [ESQUEMA_CATALOGO],
    );
    if (otras.length > 0) problemas.push(`en ${ESQUEMA_CATALOGO} hay otras tablas o vistas: ${otras.map((o) => o.relname).join(', ')}`);
    if (problemas.length === 0) problemas.push(...(await this.fkQueEntran(queryRunner, ESQUEMA_CATALOGO)));
    if (problemas.length > 0) throw new Error(`No se devuelve el catálogo a public:\n  ${problemas.join('\n  ')}`);

    for (const rol of CON_TABLAS_EN_PUBLIC) await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM "${rol}"`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO PUBLIC`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_CATALOGO}" REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_CATALOGO}" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${ESQUEMA_CATALOGO}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "${ESQUEMA_CATALOGO}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "${ESQUEMA_CATALOGO}" FROM "${ROL}"`);

    for (const t of [...TABLAS_CATALOGO].reverse()) await queryRunner.query(`ALTER TABLE "${ESQUEMA_CATALOGO}"."${t}" SET SCHEMA "public"`);
    // RESTRICT (por defecto): si quedó algo dentro, falla en vez de borrarlo
    await queryRunner.query(`DROP SCHEMA "${ESQUEMA_CATALOGO}"`);
  }

  // Claves foráneas que apuntan a tablas del catálogo desde tablas que no son del catálogo (deben ser 0)
  private async fkQueEntran(queryRunner: QueryRunner, esquema: string): Promise<string[]> {
    const filas: { conname: string; desde: string; hacia: string }[] = await queryRunner.query(
      `SELECT con.conname, con.conrelid::regclass::text AS "desde", con.confrelid::regclass::text AS "hacia"
       FROM pg_constraint con
       JOIN pg_class destino ON destino.oid = con.confrelid JOIN pg_namespace nd ON nd.oid = destino.relnamespace
       JOIN pg_class origen ON origen.oid = con.conrelid JOIN pg_namespace no ON no.oid = origen.relnamespace
       WHERE con.contype = 'f' AND nd.nspname = $1 AND destino.relname IN (${LISTA})
         AND NOT (no.nspname = $1 AND origen.relname IN (${LISTA}))`,
      [esquema],
    );
    return filas.map((f) => `la clave foránea ${f.conname} entra desde ${f.desde} hacia ${f.hacia}: quítala antes (paso 2)`);
  }
}
