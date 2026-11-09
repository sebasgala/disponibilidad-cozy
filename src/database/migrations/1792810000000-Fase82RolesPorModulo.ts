import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.2, paso 2 (decisión D7): un usuario de base por módulo. Se crean con LOGIN y SIN contraseña: la contraseña no
// vive en el repositorio, se fija al desplegar (ALTER ROLE … PASSWORD, desde una variable de entorno). Sin contraseña
// nadie puede entrar con ellos todavía, y la aplicación sigue con su conexión única hasta que existan todos los esquemas.
// Los permisos sobre cada esquema NO van aquí: se otorgan en la migración que crea o mueve cada esquema (paso 3 en adelante).
//
// Los roles son de todo el servidor de PostgreSQL, no de esta base. Por eso:
//   up()    crea solo los que no existen y les deja un comentario que los marca como de esta migración;
//   down()  borra solo los que tienen esa marca (si un rol ya existía antes, no lo toca).
export const ROLES_POR_MODULO = ['usuarios', 'catalogo', 'disponibilidad', 'reservas', 'comun'];
const MARCA = 'Cozy fase 8.2: usuario de base del módulo';

export class Fase82RolesPorModulo1792810000000 implements MigrationInterface {
  name = 'Fase82RolesPorModulo1792810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const rol of ROLES_POR_MODULO) {
      const [existe] = await queryRunner.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [rol]);
      if (existe) continue;
      await queryRunner.query(`CREATE ROLE "${rol}" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`);
      await queryRunner.query(`COMMENT ON ROLE "${rol}" IS '${MARCA} ${rol}'`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const rol of [...ROLES_POR_MODULO].reverse()) {
      const [nuestro] = await queryRunner.query(
        `SELECT 1 FROM pg_roles r JOIN pg_shdescription d ON d.objoid = r.oid AND d.classoid = 'pg_authid'::regclass
         WHERE r.rolname = $1 AND d.description = $2`,
        [rol, `${MARCA} ${rol}`],
      );
      if (nuestro) await queryRunner.query(`DROP ROLE "${rol}"`);
    }
  }
}
