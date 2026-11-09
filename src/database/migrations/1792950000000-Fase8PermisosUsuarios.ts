import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.3b: corrección pendiente de 8.2 (D7). El esquema `usuarios` existe desde 8.1 y el rol `usuarios` desde el paso 2 de
// 8.2, pero el rol nunca recibió permisos sobre su esquema: la documentación de 8.2 decía que se otorgaban en el paso 2 y no
// se hizo. Esta migración los da, con la misma forma que la del catálogo:
//   USAGE sobre el esquema; leer y escribir sus tablas (usuarios.usuarios y usuarios.outbox_usuarios); usar su secuencia;
//   y los mismos privilegios para lo que se cree después en el esquema.
// Nada sobre otros esquemas. La aplicación sigue conectándose como postgres (superusuario): no la afecta.
//
// Guardas, como en las migraciones anteriores: up() exige que el esquema, sus tablas y el rol existan; si falta algo, no
// cambia nada y dice qué. down() revoca exactamente lo que up() otorgó (es idempotente: revocar lo que no hay no falla).

const ESQUEMA = 'usuarios';
const ROL = 'usuarios';
const TABLAS = ['usuarios', 'outbox_usuarios'];

export class Fase8PermisosUsuarios1792950000000 implements MigrationInterface {
  name = 'Fase8PermisosUsuarios1792950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const problemas: string[] = [];
    if ((await queryRunner.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [ESQUEMA])).length === 0) problemas.push(`no existe el esquema ${ESQUEMA} (lo crea 1792600000000-Fase81Usuarios)`);
    for (const t of TABLAS) {
      const [{ existe }] = await queryRunner.query(`SELECT to_regclass($1) IS NOT NULL AS "existe"`, [`${ESQUEMA}.${t}`]);
      if (!existe) problemas.push(`no está ${ESQUEMA}.${t}`);
    }
    if ((await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ROL])).length === 0) problemas.push(`no existe el rol ${ROL} (lo crea 1792810000000-Fase82RolesPorModulo)`);
    if (problemas.length > 0) throw new Error(`No se otorgan los permisos de ${ROL}:\n  ${problemas.join('\n  ')}`);

    await queryRunner.query(`GRANT USAGE ON SCHEMA "${ESQUEMA}" TO "${ROL}"`);
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${ESQUEMA}" TO "${ROL}"`);
    await queryRunner.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA "${ESQUEMA}" TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA}" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${ROL}"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA}" REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM "${ROL}"`);
    await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${ESQUEMA}" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${ESQUEMA}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "${ESQUEMA}" FROM "${ROL}"`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA "${ESQUEMA}" FROM "${ROL}"`);
  }
}
