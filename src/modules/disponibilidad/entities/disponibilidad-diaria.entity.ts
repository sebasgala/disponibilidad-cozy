import { Check, Column, Entity, PrimaryColumn } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

// Una fila por habitación y por día: cuántos cupos hay en total, cuántos quedan y a qué precio.
// La clave primaria (habitacionId, fecha) también sirve de índice para la clave foránea habitacionId.
@Entity({ name: 'disponibilidad_diaria', schema: 'disponibilidad' })
@Check('CHK_disponibilidad_cupos', '"cupos" >= 0')
@Check('CHK_disponibilidad_precio', '"precio" >= 0')
@Check('CHK_disponibilidad_cupos_totales', '"cuposTotales" >= 0')
@Check('CHK_disponibilidad_cupos_maximo', '"cupos" <= "cuposTotales"')
export class DisponibilidadDiaria {
  @PrimaryColumn({ type: 'uuid' })
  habitacionId: string;

  // Fecha sin hora, formato 'YYYY-MM-DD'
  @PrimaryColumn({ type: 'date' })
  fecha: string;

  // Cupos que QUEDAN: las órdenes los descuentan al crearse y los devuelven al cancelarse. /availability lee este.
  @Column({ type: 'int' })
  cupos: number;

  // Cupos que EXISTEN esa noche (lo que edita el admin). Siempre: cupos = cuposTotales - habitaciones vendidas.
  @Column({ type: 'int' })
  cuposTotales: number;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precio: number;
}
