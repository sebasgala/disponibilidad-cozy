import { MigrationInterface, QueryRunner } from 'typeorm';

// Paso 7B: cupos totales por noche, que es lo que edita el admin.
// `cupos` sigue siendo lo que queda (lo descuentan y devuelven las órdenes); `cuposTotales` es lo que existe.
// Invariante: cupos = cuposTotales - habitaciones vendidas esa noche.
export class CuposTotales1791950800000 implements MigrationInterface {
  name = 'CuposTotales1791950800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" ADD "cuposTotales" integer`);

    // Relleno: lo que queda + lo ya vendido esa noche por órdenes vigentes (CONFIRMED y PENDING).
    // Una orden ocupa las noches [checkin, checkout). Las CANCELLED ya devolvieron sus cupos.
    await queryRunner.query(`
      UPDATE "disponibilidad_diaria" d
      SET "cuposTotales" = d."cupos" + COALESCE((
        SELECT SUM(o."habitacionesReservadas")
        FROM "ordenes" o
        WHERE o."habitacionId" = d."habitacionId"
          AND o."status" IN ('CONFIRMED', 'PENDING')
          AND d."fecha" >= o."checkin" AND d."fecha" < o."checkout"
      ), 0)
    `);

    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" ALTER COLUMN "cuposTotales" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "disponibilidad_diaria" ADD CONSTRAINT "CHK_disponibilidad_cupos_totales" CHECK ("cuposTotales" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "disponibilidad_diaria" ADD CONSTRAINT "CHK_disponibilidad_cupos_maximo" CHECK ("cupos" <= "cuposTotales")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" DROP CONSTRAINT "CHK_disponibilidad_cupos_maximo"`);
    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" DROP CONSTRAINT "CHK_disponibilidad_cupos_totales"`);
    await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" DROP COLUMN "cuposTotales"`);
  }
}
