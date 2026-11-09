import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.4 (D3, D5 y D7): reservas tiene su propio esquema.
//   reservas.ordenes, ordenes_preview, resenas, idempotency_keys, idempotencia_v2, promociones_contrato y outbox_reservas
//       Las siete tablas pasan de public a reservas con ALTER TABLE … SET SCHEMA: no se borra ni se copia ninguna fila. Con
//       cada tabla se mueven sus índices, sus restricciones (también las dos claves foráneas internas: ordenes →
//       ordenes_preview y resenas → ordenes) y sus secuencias propias. El único tipo propio, ordenes_status_enum (la columna
//       ordenes.status), se mueve también, como hizo 1792600000000 con los de usuarios: si se quedara en public, el rol
//       reservas no podría usarlo sin USAGE sobre public. No hay vistas que dependan de estas tablas.
//   rol reservas
//       USAGE sobre su esquema; leer y escribir sus tablas y usar sus secuencias, también las que se creen después. Pierde
//       el USAGE sobre public: ya no le queda nada fuera de su esquema.
//   public
//       Solo comun conserva el USAGE (sus tablas transversales siguen ahí, E1). Lo de PUBLIC y comun ya lo dejaron así
//       1792900000000 y 1793000000000; aquí se repite de forma idempotente y por eso down() NO lo deshace.
//   El publicador del feed (comun) lee y marca outbox_reservas, pero NO recibe permisos en este esquema todavía: la
//   aplicación se conecta como postgres (superusuario) y los permisos no la afectan.
//
// Guardas, como en 8.2 y 8.3: up() exige que el esquema no exista, que las siete tablas estén en public, que existan los
// cinco roles y que ninguna clave foránea cruce el borde del módulo (entrando o saliendo). down() exige lo mismo al revés y
// que en reservas no haya nada más (por ejemplo, la tabla de la saga sin deshacer); si algo no cuadra, no cambia nada y
// dice qué encontró. DROP SCHEMA es RESTRICT: si quedara algo dentro, falla en vez de borrarlo.

export const ESQUEMA_RESERVAS = 'reservas';
export const TABLAS_RESERVAS = ['ordenes_preview', 'ordenes', 'resenas', 'idempotency_keys', 'idempotencia_v2', 'promociones_contrato', 'outbox_reservas'];
export const TIPOS_RESERVAS = ['ordenes_status_enum'];
const ROL = 'reservas';
const ROLES = ['disponibilidad', 'usuarios', 'catalogo', 'reservas', 'comun'];
const SIGUEN_EN_PUBLIC = ['comun'];
const LISTA = TABLAS_RESERVAS.map((t) => `'${t}'`).join(', ');

export class Fase84EsquemaReservas1793100000000 implements MigrationInterface {
  name = 'Fase84EsquemaReservas1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if ((await queryRunner.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [ESQUEMA_RESERVAS])).length > 0) problemas.push(`el esquema ${ESQUEMA_RESERVAS} ya existe`);
    for (const t of TABLAS_RESERVAS) {
      const [{ existe }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe"`, [`public.${t}`]);
      if (!existe) problemas.push(`no está public.${t}`);
    }
    for (const tipo of TIPOS_RESERVAS) {
      if (!(await this.tipoEn(queryRunner, 'public', tipo))) problemas.push(`no está el tipo public.${tipo}`);
    }
    for (const rol of ROLES) {
      if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol])).length === 0) problemas.push(`no existe el rol ${rol} (lo crea 1792810000000-Fase82RolesPorModulo)`);
    }
    if (problemas.length === 0) problemas.push(...(await this.fkQueCruzan(queryRunner, 'public')));
    if (problemas.length > 0) throw new Error(`No se mueve reservas a su esquema:\n  ${problemas.join('\n  ')}`);

    await queryRunner.query(`CREATE SCHEMA "${ESQUEMA_RESERVAS}"`);
    for (const t of TABLAS_RESERVAS) await queryRunner.query(`ALTER TABLE "public"."${t}" SET SCHEMA "${ESQUEMA_RESERVAS}"`);
    for (const tipo of TIPOS_RESERVAS) await queryRunner.query(`ALTER TYPE "public"."${tipo}" SET SCHEMA "${ESQUEMA_RESERVAS}"`);

    // Permisos del rol reservas: solo su esquema
    await queryRunner.query(`GRANT USAGE ON SCHEMA "${ESQUEMA_RESERVAS}" TO "${ROL}"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${ESQUEMA_RESERVAS}" TO "${ROL}"`);
    await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${ESQUEMA_RESERVAS}" TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_RESERVAS}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_RESERVAS}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${ROL}"`);
    // Y nada fuera de él: ya no tiene tablas en public
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM "${ROL}"`);
    // public cerrado a todos menos a comun (idempotente: ya lo dejaron así 1792900000000 y 1793000000000)
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM PUBLIC`);
    for (const rol of SIGUEN_EN_PUBLIC) await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "${rol}"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    for (const t of TABLAS_RESERVAS) {
      const [{ existe, ocupado }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe", to_regclass($2) IS NOT NULL AS "ocupado"`, [`${ESQUEMA_RESERVAS}.${t}`, `public.${t}`]);
      if (!existe) problemas.push(`no está ${ESQUEMA_RESERVAS}.${t}`);
      if (ocupado) problemas.push(`ya existe public.${t}`);
    }
    for (const tipo of TIPOS_RESERVAS) {
      if (!(await this.tipoEn(queryRunner, ESQUEMA_RESERVAS, tipo))) problemas.push(`no está el tipo ${ESQUEMA_RESERVAS}.${tipo}`);
      if (await this.tipoEn(queryRunner, 'public', tipo)) problemas.push(`ya existe el tipo public.${tipo}`);
    }
    for (const rol of ROLES) {
      if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol])).length === 0) problemas.push(`no existe el rol ${rol}`);
    }
    // En el esquema solo pueden estar las 7 tablas (sus secuencias e índices van con ellas)
    const otras: { relname: string }[] = await queryRunner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname NOT IN (${LISTA})`,
      [ESQUEMA_RESERVAS],
    );
    if (otras.length > 0) problemas.push(`en ${ESQUEMA_RESERVAS} hay otras tablas o vistas: ${otras.map((o) => o.relname).join(', ')}`);
    if (problemas.length === 0) problemas.push(...(await this.fkQueCruzan(queryRunner, ESQUEMA_RESERVAS)));
    if (problemas.length > 0) throw new Error(`No se devuelve reservas a public:\n  ${problemas.join('\n  ')}`);

    // El rol vuelve a tener USAGE sobre public, como lo tenía antes. Lo de PUBLIC y comun no se toca.
    await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_RESERVAS}" REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_RESERVAS}" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${ESQUEMA_RESERVAS}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "${ESQUEMA_RESERVAS}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "${ESQUEMA_RESERVAS}" FROM "${ROL}"`);

    for (const tipo of TIPOS_RESERVAS) await queryRunner.query(`ALTER TYPE "${ESQUEMA_RESERVAS}"."${tipo}" SET SCHEMA "public"`);
    for (const t of [...TABLAS_RESERVAS].reverse()) await queryRunner.query(`ALTER TABLE "${ESQUEMA_RESERVAS}"."${t}" SET SCHEMA "public"`);
    // RESTRICT (por defecto): si quedó algo dentro, falla en vez de borrarlo
    await queryRunner.query(`DROP SCHEMA "${ESQUEMA_RESERVAS}" RESTRICT`);
  }

  private async tipoEn(queryRunner: QueryRunner, esquema: string, tipo: string): Promise<boolean> {
    return (await queryRunner.query(`SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = $2`, [esquema, tipo])).length > 0;
  }

  // Claves foráneas que cruzan el borde del módulo: hacia sus tablas desde fuera o desde sus tablas hacia fuera (deben ser 0)
  private async fkQueCruzan(queryRunner: QueryRunner, esquema: string): Promise<string[]> {
    const filas: { conname: string; desde: string; hacia: string }[] = await queryRunner.query(
      `SELECT con.conname, con.conrelid::regclass::text AS "desde", con.confrelid::regclass::text AS "hacia"
       FROM pg_constraint con
       JOIN pg_class destino ON destino.oid = con.confrelid JOIN pg_namespace nd ON nd.oid = destino.relnamespace
       JOIN pg_class origen ON origen.oid = con.conrelid JOIN pg_namespace no ON no.oid = origen.relnamespace
       WHERE con.contype = 'f'
         AND (nd.nspname = $1 AND destino.relname IN (${LISTA})) <> (no.nspname = $1 AND origen.relname IN (${LISTA}))`,
      [esquema],
    );
    return filas.map((f) => `la clave foránea ${f.conname} cruza el borde del módulo (${f.desde} → ${f.hacia}): quítala antes (1792800000000)`);
  }
}
