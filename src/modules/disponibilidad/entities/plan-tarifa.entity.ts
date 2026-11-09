import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';

// Plan de tarifa ADICIONAL de una habitación (contrato v2, RatePlanV2). El plan por defecto (ESTANDAR) no está aquí:
// se deriva de la propia habitación (precio por noche, mealPlan y cancellationType), ver v2/planes.ts.
@Entity({ name: 'planes_tarifa', schema: 'disponibilidad' })
@Unique('UQ_planes_tarifa_habitacion_codigo', ['habitacionId', 'codigo'])
@Check('CHK_planes_tarifa_codigo', `"codigo" ~ '^[A-Z0-9_]{2,30}$' AND "codigo" <> 'ESTANDAR'`)
@Check('CHK_planes_tarifa_regimen', `"regimen" IN ('SOLO_HABITACION', 'DESAYUNO_INCLUIDO', 'MEDIA_PENSION', 'PENSION_COMPLETA', 'TODO_INCLUIDO')`)
@Check('CHK_planes_tarifa_modelo_pago', `"modeloPago" IN ('PREPAGO', 'PAGO_EN_HOTEL', 'GARANTIA_TARJETA')`)
@Check('CHK_planes_tarifa_ajuste', '"ajustePorcentaje" BETWEEN -90 AND 500')
@Check('CHK_planes_tarifa_ocupacion', '"ocupacionBase" BETWEEN 1 AND 20')
@Check('CHK_planes_tarifa_suplementos', '"suplementoAdultoExtra" >= 0 AND "suplementoNino" >= 0')
@Check('CHK_planes_tarifa_edad', '"edadMaximaGratisNinos" BETWEEN 0 AND 17')
@Check(
  'CHK_planes_tarifa_cancelacion',
  '("horasLimiteCancelacion" IS NULL OR "horasLimiteCancelacion" BETWEEN 0 AND 720) AND ("penalidadPorcentaje" IS NULL OR "penalidadPorcentaje" BETWEEN 0 AND 100)',
)
export class PlanTarifa {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_planes_tarifa' })
  id: string;

  @Column({ type: 'uuid' })
  habitacionId: string;

  @Column({ type: 'varchar', length: 30 })
  codigo: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 20 })
  regimen: string;

  @Column({ type: 'varchar', length: 20, default: 'PREPAGO' })
  modeloPago: string;

  @Column({ type: 'boolean' })
  esReembolsable: boolean;

  @Column({ type: 'int', nullable: true })
  horasLimiteCancelacion: number | null;

  @Column('numeric', { precision: 5, scale: 2, nullable: true, transformer: new ColumnNumericTransformer() })
  penalidadPorcentaje: number | null;

  // Sobre el precio del día de la habitación: −10.00 = 10 % más barato
  @Column('numeric', { precision: 5, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  ajustePorcentaje: number;

  @Column({ type: 'int', default: 2 })
  ocupacionBase: number;

  @Column('numeric', { precision: 10, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  suplementoAdultoExtra: number;

  @Column({ type: 'int', default: 17 })
  edadMaximaGratisNinos: number;

  @Column('numeric', { precision: 10, scale: 2, default: 0, transformer: new ColumnNumericTransformer() })
  suplementoNino: number;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn: Date;
}
