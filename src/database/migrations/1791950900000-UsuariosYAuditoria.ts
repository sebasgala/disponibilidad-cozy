import { MigrationInterface, QueryRunner } from 'typeorm';

// Paso 8: usuarios, roles, propietario del alojamiento, cliente de la orden y auditoría de cambios.
export class UsuariosYAuditoria1791950900000 implements MigrationInterface {
  name = 'UsuariosYAuditoria1791950900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. ordenes.ownerId (texto con el "sub" de un JWT que nunca existió) -> ordenes.clienteId (uuid, FK a usuarios).
    //    Antes de las cuentas ownerId siempre fue NULL. Si alguna fila lo tuviera, no hay a qué usuario asignarla:
    //    la migración se detiene en lugar de borrar el dato en silencio.
    const [{ conOwner }] = await queryRunner.query(`SELECT count(*)::int AS "conOwner" FROM "ordenes" WHERE "ownerId" IS NOT NULL`);
    if (conOwner > 0) {
      throw new Error(`Hay ${conOwner} órdenes con ownerId; no se pueden convertir a clienteId. Revísalas antes de migrar.`);
    }
    await queryRunner.query(`DROP INDEX "public"."IDX_3c04fee9a479ae01f2c92f308e"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP COLUMN "ownerId"`);

    // 2. Usuarios.
    await queryRunner.query(`CREATE TYPE "public"."usuarios_rol_enum" AS ENUM('cliente', 'administrador', 'superadmin')`);
    await queryRunner.query(`CREATE TYPE "public"."usuarios_estado_enum" AS ENUM('pendiente', 'activo', 'suspendido')`);
    await queryRunner.query(
      `CREATE TABLE "usuarios" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "passwordHash" character varying(100) NOT NULL, "nombre" character varying(120) NOT NULL, "apellido" character varying(120) NOT NULL, "rol" "public"."usuarios_rol_enum" NOT NULL DEFAULT 'cliente', "estado" "public"."usuarios_estado_enum" NOT NULL DEFAULT 'activo', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_446adfc18b35418aac32ae0b7b5" UNIQUE ("email"), CONSTRAINT "PK_d7281c63c176e152e4c531594a8" PRIMARY KEY ("id"))`,
    );

    // 3. Propietario del alojamiento y cliente de la orden (ambos opcionales).
    await queryRunner.query(`ALTER TABLE "alojamientos" ADD "propietarioId" uuid`);
    await queryRunner.query(`CREATE INDEX "IX_alojamientos_propietarioId" ON "alojamientos" ("propietarioId") `);
    await queryRunner.query(
      `ALTER TABLE "alojamientos" ADD CONSTRAINT "FK_c925f3ac75bfe357c34a66bc595" FOREIGN KEY ("propietarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "ordenes" ADD "clienteId" uuid`);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_clienteId" ON "ordenes" ("clienteId") `);
    await queryRunner.query(
      `ALTER TABLE "ordenes" ADD CONSTRAINT "FK_09e7c5c2a11a208941307638614" FOREIGN KEY ("clienteId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // 4. Auditoría de cambios.
    await queryRunner.query(
      `CREATE TABLE "auditoria_cambios" ("id" BIGSERIAL NOT NULL, "usuarioId" uuid, "accion" character varying(60) NOT NULL, "entidad" character varying(60) NOT NULL, "entidadId" character varying(120) NOT NULL, "antes" jsonb, "despues" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1baf22c06cf3c35dd1076cf7320" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IX_auditoria_usuarioId" ON "auditoria_cambios" ("usuarioId") `);
    await queryRunner.query(`CREATE INDEX "IX_auditoria_createdAt" ON "auditoria_cambios" ("createdAt") `);
    await queryRunner.query(`CREATE INDEX "IX_auditoria_entidad" ON "auditoria_cambios" ("entidad", "entidadId") `);
    await queryRunner.query(
      `ALTER TABLE "auditoria_cambios" ADD CONSTRAINT "FK_2763222d0b7b3e4d50d82f67f43" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auditoria_cambios" DROP CONSTRAINT "FK_2763222d0b7b3e4d50d82f67f43"`);
    await queryRunner.query(`DROP INDEX "public"."IX_auditoria_entidad"`);
    await queryRunner.query(`DROP INDEX "public"."IX_auditoria_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IX_auditoria_usuarioId"`);
    await queryRunner.query(`DROP TABLE "auditoria_cambios"`);

    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "FK_09e7c5c2a11a208941307638614"`);
    await queryRunner.query(`DROP INDEX "public"."IX_ordenes_clienteId"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP COLUMN "clienteId"`);
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "FK_c925f3ac75bfe357c34a66bc595"`);
    await queryRunner.query(`DROP INDEX "public"."IX_alojamientos_propietarioId"`);
    await queryRunner.query(`ALTER TABLE "alojamientos" DROP COLUMN "propietarioId"`);

    await queryRunner.query(`DROP TABLE "usuarios"`);
    await queryRunner.query(`DROP TYPE "public"."usuarios_estado_enum"`);
    await queryRunner.query(`DROP TYPE "public"."usuarios_rol_enum"`);

    // ownerId vuelve vacío (los clienteId se pierden: eran uuid de usuarios que ya no existen).
    await queryRunner.query(`ALTER TABLE "ordenes" ADD "ownerId" character varying(255)`);
    await queryRunner.query(`CREATE INDEX "IDX_3c04fee9a479ae01f2c92f308e" ON "ordenes" ("ownerId") `);
  }
}
