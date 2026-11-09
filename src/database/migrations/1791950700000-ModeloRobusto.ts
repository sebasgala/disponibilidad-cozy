import { MigrationInterface, QueryRunner } from 'typeorm';

// Paso 7A: bloque "imprescindible" de docs/auditoria-modelo-datos.md.
// Escrita a mano (no generada): TypeORM cambia el tipo de una columna borrándola y creándola de nuevo,
// lo que perdería las fechas existentes; aquí se usa ALTER COLUMN ... TYPE ... USING.
// Si una orden o preview viejo no cumple una regla nueva, la migración falla y no deja nada a medias.
export class ModeloRobusto1791950700000 implements MigrationInterface {
  name = 'ModeloRobusto1791950700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Borrado lógico de habitaciones (las existentes quedan activas).
    await queryRunner.query(`ALTER TABLE "habitaciones" ADD "activo" boolean NOT NULL DEFAULT true`);

    // 2. Fechas obligatorias en órdenes y previews (falla si hay alguna fila con NULL).
    await queryRunner.query(`ALTER TABLE "ordenes_preview" ALTER COLUMN "checkin" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes_preview" ALTER COLUMN "checkout" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes" ALTER COLUMN "checkin" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes" ALTER COLUMN "checkout" SET NOT NULL`);

    // 3. Habitaciones reservadas como columna: se rellena desde guests.number_of_rooms y luego se exige.
    await queryRunner.query(`ALTER TABLE "ordenes" ADD "habitacionesReservadas" integer`);
    await queryRunner.query(`UPDATE "ordenes" SET "habitacionesReservadas" = ("guests"->>'number_of_rooms')::integer`);
    await queryRunner.query(`ALTER TABLE "ordenes" ALTER COLUMN "habitacionesReservadas" SET NOT NULL`);

    // 4. Preview de origen: un preview da una sola orden. Las órdenes existentes quedan con NULL.
    await queryRunner.query(`ALTER TABLE "ordenes" ADD "previewId" uuid`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_ordenes_previewId" ON "ordenes" ("previewId") `);
    await queryRunner.query(
      `ALTER TABLE "ordenes" ADD CONSTRAINT "FK_ordenes_previewId" FOREIGN KEY ("previewId") REFERENCES "ordenes_preview"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // 5. Fechas de auditoría con zona horaria. Los valores guardados se interpretan como UTC.
    for (const [tabla, columna] of [
      ['alojamientos', 'updatedAt'],
      ['ordenes_preview', 'createdAt'],
      ['ordenes', 'createdAt'],
      ['ordenes', 'updatedAt'],
      ['idempotency_keys', 'createdAt'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${tabla}" ALTER COLUMN "${columna}" TYPE TIMESTAMP WITH TIME ZONE USING "${columna}" AT TIME ZONE 'UTC'`,
      );
    }

    // 6. Índices: claves foráneas (la de disponibilidad_diaria ya la cubre su PK), vencimiento y fecha de creación.
    await queryRunner.query(`CREATE INDEX "IX_alojamientos_ciudadId" ON "alojamientos" ("ciudadId") `);
    await queryRunner.query(`CREATE INDEX "IX_habitaciones_alojamientoId" ON "habitaciones" ("alojamientoId") `);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_preview_alojamientoId" ON "ordenes_preview" ("alojamientoId") `);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_preview_habitacionId" ON "ordenes_preview" ("habitacionId") `);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_preview_expiresAt" ON "ordenes_preview" ("expiresAt") `);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_alojamientoId" ON "ordenes" ("alojamientoId") `);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_habitacionId" ON "ordenes" ("habitacionId") `);
    await queryRunner.query(`CREATE INDEX "IX_ordenes_createdAt" ON "ordenes" ("createdAt") `);
    await queryRunner.query(`CREATE INDEX "IX_idempotency_keys_createdAt" ON "idempotency_keys" ("createdAt") `);

    // 7. Reglas de negocio en la base (falla si algún dato existente no las cumple).
    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" ADD CONSTRAINT "CHK_disponibilidad_cupos" CHECK ("cupos" >= 0)`);
    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" ADD CONSTRAINT "CHK_disponibilidad_precio" CHECK ("precio" >= 0)`);
    await queryRunner.query(`ALTER TABLE "habitaciones" ADD CONSTRAINT "CHK_habitaciones_precio_base" CHECK ("precioBase" >= 0)`);
    await queryRunner.query(`ALTER TABLE "alojamientos" ADD CONSTRAINT "CHK_alojamientos_precio_por_noche" CHECK ("precioPorNoche" >= 0)`);
    await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "CHK_ordenes_total" CHECK ("totalPrice" >= 0)`);
    await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "CHK_ordenes_fechas" CHECK ("checkout" > "checkin")`);
    await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "CHK_ordenes_habitaciones_reservadas" CHECK ("habitacionesReservadas" >= 1)`);
    await queryRunner.query(`ALTER TABLE "ordenes_preview" ADD CONSTRAINT "CHK_ordenes_preview_total" CHECK ("totalPrice" >= 0)`);
    await queryRunner.query(`ALTER TABLE "ordenes_preview" ADD CONSTRAINT "CHK_ordenes_preview_fechas" CHECK ("checkout" > "checkin")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [tabla, check] of [
      ['ordenes_preview', 'CHK_ordenes_preview_fechas'],
      ['ordenes_preview', 'CHK_ordenes_preview_total'],
      ['ordenes', 'CHK_ordenes_habitaciones_reservadas'],
      ['ordenes', 'CHK_ordenes_fechas'],
      ['ordenes', 'CHK_ordenes_total'],
      ['alojamientos', 'CHK_alojamientos_precio_por_noche'],
      ['habitaciones', 'CHK_habitaciones_precio_base'],
      ['disponibilidad_diaria', 'CHK_disponibilidad_precio'],
      ['disponibilidad_diaria', 'CHK_disponibilidad_cupos'],
    ]) {
      await queryRunner.query(`ALTER TABLE "${tabla}" DROP CONSTRAINT "${check}"`);
    }

    for (const indice of [
      'IX_idempotency_keys_createdAt',
      'IX_ordenes_createdAt',
      'IX_ordenes_habitacionId',
      'IX_ordenes_alojamientoId',
      'IX_ordenes_preview_expiresAt',
      'IX_ordenes_preview_habitacionId',
      'IX_ordenes_preview_alojamientoId',
      'IX_habitaciones_alojamientoId',
      'IX_alojamientos_ciudadId',
    ]) {
      await queryRunner.query(`DROP INDEX "public"."${indice}"`);
    }

    for (const [tabla, columna] of [
      ['idempotency_keys', 'createdAt'],
      ['ordenes', 'updatedAt'],
      ['ordenes', 'createdAt'],
      ['ordenes_preview', 'createdAt'],
      ['alojamientos', 'updatedAt'],
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${tabla}" ALTER COLUMN "${columna}" TYPE TIMESTAMP WITHOUT TIME ZONE USING "${columna}" AT TIME ZONE 'UTC'`,
      );
    }

    await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "FK_ordenes_previewId"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_ordenes_previewId"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP COLUMN "previewId"`);
    await queryRunner.query(`ALTER TABLE "ordenes" DROP COLUMN "habitacionesReservadas"`);

    await queryRunner.query(`ALTER TABLE "ordenes" ALTER COLUMN "checkout" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes" ALTER COLUMN "checkin" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes_preview" ALTER COLUMN "checkout" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "ordenes_preview" ALTER COLUMN "checkin" DROP NOT NULL`);

    await queryRunner.query(`ALTER TABLE "habitaciones" DROP COLUMN "activo"`);
  }
}
