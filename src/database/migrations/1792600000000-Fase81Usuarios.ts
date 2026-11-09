import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.1: el dominio usuarios tiene su propio esquema y las tablas de otros dominios ya no lo referencian por FK.
//   usuarios.usuarios            la tabla pasa del esquema public a su esquema propio (con sus tipos enum)
//   FK hacia usuarios            se quitan: alojamientos.propietarioId, ordenes.clienteId, resenas.clienteId y
//                                auditoria_cambios.usuarioId. Las referencias quedan lógicas (el id del usuario):
//                                el catálogo, reservas y la auditoría no necesitan que el usuario exista en la base
//                                para guardar su id. Ninguna FK nueva cruza dominios.
// Nadie borra usuarios (la baja es suspender), así que perder estas FK no cambia ningún comportamiento.
export class Fase81Usuarios1792600000000 implements MigrationInterface {
  name = 'Fase81Usuarios1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "usuarios"`);
    await queryRunner.query(`ALTER TABLE "public"."usuarios" SET SCHEMA "usuarios"`);
    await queryRunner.query(`ALTER TYPE "public"."usuarios_rol_enum" SET SCHEMA "usuarios"`);
    await queryRunner.query(`ALTER TYPE "public"."usuarios_estado_enum" SET SCHEMA "usuarios"`);

    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "FK_c925f3ac75bfe357c34a66bc595"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "FK_09e7c5c2a11a208941307638614"`);
    await queryRunner.query(`ALTER TABLE "auditoria_cambios" DROP CONSTRAINT "FK_2763222d0b7b3e4d50d82f67f43"`);
    await queryRunner.query(`ALTER TABLE "resenas" DROP CONSTRAINT "FK_resenas_clienteId"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "resenas" ADD CONSTRAINT "FK_resenas_clienteId" FOREIGN KEY ("clienteId") REFERENCES "usuarios"."usuarios"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "auditoria_cambios" ADD CONSTRAINT "FK_2763222d0b7b3e4d50d82f67f43" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"."usuarios"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "FK_09e7c5c2a11a208941307638614" FOREIGN KEY ("clienteId") REFERENCES "usuarios"."usuarios"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "alojamientos" ADD CONSTRAINT "FK_c925f3ac75bfe357c34a66bc595" FOREIGN KEY ("propietarioId") REFERENCES "usuarios"."usuarios"("id") ON DELETE RESTRICT`);

    await queryRunner.query(`ALTER TYPE "usuarios"."usuarios_estado_enum" SET SCHEMA "public"`);
    await queryRunner.query(`ALTER TYPE "usuarios"."usuarios_rol_enum" SET SCHEMA "public"`);
    await queryRunner.query(`ALTER TABLE "usuarios"."usuarios" SET SCHEMA "public"`);
  }
}
