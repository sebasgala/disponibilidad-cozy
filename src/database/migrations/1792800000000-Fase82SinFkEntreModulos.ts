import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 8.2, paso 2 (decisiones D3 y D7): una sola base, un esquema por módulo y ninguna clave foránea entre módulos.
// Se quitan las 12 que quedaban: las 11 que apuntan al catálogo (desde reservas y disponibilidad) y la de reservas
// hacia disponibilidad (ordenes.cotizacionId). No se borra ni se cambia ninguna fila: solo dejan de ser restricciones.
// Las referencias quedan lógicas: el id se valida por el puerto del otro módulo al crear la fila, y
// scripts/verificar-huerfanos.mjs comprueba que ninguno apunte a algo que no existe.
// Se quedan las 4 internas de un módulo: alojamientos.ciudadId y habitaciones.alojamientoId (catálogo),
// ordenes.previewId y resenas.ordenId (reservas).
//
// down() vuelve a crear cada clave con su nombre y su ON DELETE originales (así los down() de las migraciones
// anteriores, que las borran por nombre, siguen funcionando). Antes comprueba que no haya huérfanos: si hay alguno,
// no cambia nada y dice en qué columnas y con qué ids.

// [tabla, restricción, columna, tabla a la que apunta, ON DELETE original]
export const FK_ENTRE_MODULOS: [string, string, string, string, string][] = [
  // reservas → catálogo
  ['ordenes', 'FK_3dafdab87a9ee603ec7df3a5beb', 'alojamientoId', 'alojamientos', 'NO ACTION'],
  ['ordenes', 'FK_2dc69324387a9c17d8589028529', 'habitacionId', 'habitaciones', 'NO ACTION'],
  ['ordenes_preview', 'FK_5513e3b057874a54c4fcff75ed6', 'alojamientoId', 'alojamientos', 'NO ACTION'],
  ['ordenes_preview', 'FK_f1b5851b6500d608c3a12e071c3', 'habitacionId', 'habitaciones', 'NO ACTION'],
  ['resenas', 'FK_resenas_alojamientoId', 'alojamientoId', 'alojamientos', 'CASCADE'],
  // disponibilidad → catálogo
  ['disponibilidad_diaria', 'FK_f83c9c7d2bac624d897cf615247', 'habitacionId', 'habitaciones', 'CASCADE'],
  ['planes_tarifa', 'FK_planes_tarifa_habitacionId', 'habitacionId', 'habitaciones', 'CASCADE'],
  ['restricciones_dia', 'FK_restricciones_dia_habitacionId', 'habitacionId', 'habitaciones', 'CASCADE'],
  ['cotizaciones', 'FK_cotizaciones_alojamientoId', 'alojamientoId', 'alojamientos', 'NO ACTION'],
  ['cotizaciones', 'FK_cotizaciones_habitacionId', 'habitacionId', 'habitaciones', 'NO ACTION'],
  ['outbox_stock', 'FK_outbox_stock_habitacionId', 'habitacionId', 'habitaciones', 'CASCADE'],
  // reservas → disponibilidad
  ['ordenes', 'FK_ordenes_cotizacionId', 'cotizacionId', 'cotizaciones', 'SET NULL'],
];

export class Fase82SinFkEntreModulos1792800000000 implements MigrationInterface {
  name = 'Fase82SinFkEntreModulos1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [tabla, restriccion] of FK_ENTRE_MODULOS) {
      await queryRunner.query(`ALTER TABLE "${tabla}" DROP CONSTRAINT "${restriccion}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Huérfanos: filas cuyo id (no nulo) no existe en la tabla a la que apuntaría la clave
    const huerfanos: string[] = [];
    for (const [tabla, , columna, destino] of FK_ENTRE_MODULOS) {
      const [{ n, ejemplos }] = await queryRunner.query(
        `SELECT count(*)::int AS "n", (array_agg(DISTINCT x."${columna}"::text))[1:5] AS "ejemplos"
         FROM "${tabla}" x
         WHERE x."${columna}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${destino}" d WHERE d."id" = x."${columna}")`,
      );
      if (n > 0) huerfanos.push(`${tabla}.${columna} → ${destino}: ${n} filas (ids: ${(ejemplos ?? []).join(', ')})`);
    }
    if (huerfanos.length > 0) {
      throw new Error(`No se restauran las claves foráneas: hay huérfanos que las violarían.\n  ${huerfanos.join('\n  ')}`);
    }
    for (const [tabla, restriccion, columna, destino, alBorrar] of [...FK_ENTRE_MODULOS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "${tabla}" ADD CONSTRAINT "${restriccion}" FOREIGN KEY ("${columna}") REFERENCES "${destino}"("id") ON DELETE ${alBorrar} ON UPDATE NO ACTION`,
      );
    }
  }
}
