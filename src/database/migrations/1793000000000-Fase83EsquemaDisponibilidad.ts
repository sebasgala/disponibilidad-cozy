import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.3d (D3, D5 y D7): disponibilidad tiene su propio esquema.
//   disponibilidad.disponibilidad_diaria, planes_tarifa, restricciones_dia, cotizaciones, outbox_stock, retenciones_cupos
//   y outbox_disponibilidad
//       Las siete tablas pasan de public a disponibilidad con ALTER TABLE … SET SCHEMA: no se borra ni se copia ninguna
//       fila. Con cada tabla se mueven sus índices, sus restricciones y sus secuencias propias (outbox_stock_id_seq y
//       outbox_disponibilidad_id_seq). No tienen tipos enum ni vistas que dependan de ellas.
//   rol disponibilidad
//       USAGE sobre su esquema; leer y escribir sus tablas y usar sus secuencias, también las que se creen después. Pierde
//       el USAGE sobre public que le dio 1792900000000 (lo tenía porque sus tablas estaban ahí): ya no le queda nada fuera
//       de su esquema.
//   public
//       Se asegura que PUBLIC no tenga USAGE y que reservas y comun (que todavía tienen tablas ahí) lo tengan explícito.
//       Ya lo hizo 1792900000000-Fase82EsquemaCatalogo; aquí se repite de forma idempotente y por eso down() NO lo
//       deshace (es de esa migración).
//   El publicador del feed (comun) lee y marca outbox_disponibilidad, pero NO recibe permisos en este esquema todavía:
//   la aplicación se conecta como postgres (superusuario) y los permisos no la afectan.
//
// Guardas, como en 8.2: up() exige que el esquema no exista, que las siete tablas estén en public, que existan los cinco
// roles y que ninguna clave foránea cruce el borde del módulo (entrando o saliendo; las quitó 1792800000000). down()
// exige lo mismo al revés y que en disponibilidad no haya nada más; si algo no cuadra, no cambia nada y dice qué
// encontró. DROP SCHEMA es RESTRICT: si quedara algo dentro, falla en vez de borrarlo.

export const ESQUEMA_DISPONIBILIDAD = 'disponibilidad';
export const TABLAS_DISPONIBILIDAD = ['disponibilidad_diaria', 'planes_tarifa', 'restricciones_dia', 'cotizaciones', 'outbox_stock', 'retenciones_cupos', 'outbox_disponibilidad'];
const ROL = 'disponibilidad';
const ROLES = ['disponibilidad', 'usuarios', 'catalogo', 'reservas', 'comun'];
const SIGUEN_EN_PUBLIC = ['reservas', 'comun'];
const LISTA = TABLAS_DISPONIBILIDAD.map((t) => `'${t}'`).join(', ');

export class Fase83EsquemaDisponibilidad1793000000000 implements MigrationInterface {
  name = 'Fase83EsquemaDisponibilidad1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if ((await queryRunner.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [ESQUEMA_DISPONIBILIDAD])).length > 0) problemas.push(`el esquema ${ESQUEMA_DISPONIBILIDAD} ya existe`);
    for (const t of TABLAS_DISPONIBILIDAD) {
      const [{ existe }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe"`, [`public.${t}`]);
      if (!existe) problemas.push(`no está public.${t}`);
    }
    for (const rol of ROLES) {
      if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol])).length === 0) problemas.push(`no existe el rol ${rol} (lo crea 1792810000000-Fase82RolesPorModulo)`);
    }
    if (problemas.length === 0) problemas.push(...(await this.fkQueCruzan(queryRunner, 'public')));
    if (problemas.length > 0) throw new Error(`No se mueve disponibilidad a su esquema:\n  ${problemas.join('\n  ')}`);

    await queryRunner.query(`CREATE SCHEMA "${ESQUEMA_DISPONIBILIDAD}"`);
    for (const t of TABLAS_DISPONIBILIDAD) await queryRunner.query(`ALTER TABLE "public"."${t}" SET SCHEMA "${ESQUEMA_DISPONIBILIDAD}"`);

    // Permisos del rol disponibilidad: solo su esquema
    await queryRunner.query(`GRANT USAGE ON SCHEMA "${ESQUEMA_DISPONIBILIDAD}" TO "${ROL}"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" TO "${ROL}"`);
    await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${ROL}"`);
    // Y nada fuera de él: ya no tiene tablas en public
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM "${ROL}"`);
    // public cerrado a todos menos a los módulos que siguen ahí (idempotente: ya lo dejó así 1792900000000)
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "public" FROM PUBLIC`);
    for (const rol of SIGUEN_EN_PUBLIC) await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "${rol}"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    for (const t of TABLAS_DISPONIBILIDAD) {
      const [{ existe, ocupado }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe", to_regclass($2) IS NOT NULL AS "ocupado"`, [`${ESQUEMA_DISPONIBILIDAD}.${t}`, `public.${t}`]);
      if (!existe) problemas.push(`no está ${ESQUEMA_DISPONIBILIDAD}.${t}`);
      if (ocupado) problemas.push(`ya existe public.${t}`);
    }
    for (const rol of ROLES) {
      if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol])).length === 0) problemas.push(`no existe el rol ${rol}`);
    }
    // En el esquema solo pueden estar las 7 tablas (sus secuencias e índices van con ellas)
    const otras: { relname: string }[] = await queryRunner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname NOT IN (${LISTA})`,
      [ESQUEMA_DISPONIBILIDAD],
    );
    if (otras.length > 0) problemas.push(`en ${ESQUEMA_DISPONIBILIDAD} hay otras tablas o vistas: ${otras.map((o) => o.relname).join(', ')}`);
    if (problemas.length === 0) problemas.push(...(await this.fkQueCruzan(queryRunner, ESQUEMA_DISPONIBILIDAD)));
    if (problemas.length > 0) throw new Error(`No se devuelve disponibilidad a public:\n  ${problemas.join('\n  ')}`);

    // El rol vuelve a tener USAGE sobre public, como lo dejó 1792900000000. Lo de PUBLIC, reservas y comun no se toca.
    await queryRunner.query(`GRANT USAGE ON SCHEMA "public" TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "${ESQUEMA_DISPONIBILIDAD}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "${ESQUEMA_DISPONIBILIDAD}" FROM "${ROL}"`);

    for (const t of [...TABLAS_DISPONIBILIDAD].reverse()) await queryRunner.query(`ALTER TABLE "${ESQUEMA_DISPONIBILIDAD}"."${t}" SET SCHEMA "public"`);
    // RESTRICT (por defecto): si quedó algo dentro, falla en vez de borrarlo
    await queryRunner.query(`DROP SCHEMA "${ESQUEMA_DISPONIBILIDAD}" RESTRICT`);
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
