import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

export enum EstadoRetencion {
  RETENIDA = 'RETENIDA',
  LIBERADA = 'LIBERADA',
}

// Cupos retenidos por una orden (fase 8.0): ReservarCupos crea la fila y descuenta; LiberarCupos la marca LIBERADA y
// devuelve. La clave es la orden, así repetir cualquiera de las dos no descuenta ni devuelve dos veces.
// Saga de 8.4: la retención nace provisional (venceEn = 15 minutos después) y ConfirmarRetencion la confirma (venceEn
// null, confirmadaEn). Una provisional vencida la libera el barrido de disponibilidad, sin aviso de stock: Booking solo
// se entera al confirmar. Las retenciones de antes de 8.4 quedan con venceEn null: cuentan como confirmadas.
// ordenId y habitacionId son referencias lógicas a reservas y al catálogo: sin FK.
@Entity({ name: 'retenciones_cupos', schema: 'disponibilidad' })
@Check('CHK_retenciones_cupos_cantidad', '"cantidad" > 0')
@Check('CHK_retenciones_cupos_fechas', '"checkout" > "checkin"')
@Check('CHK_retenciones_cupos_estado', `"estado" IN ('RETENIDA', 'LIBERADA') AND (("estado" = 'LIBERADA') = ("liberadaEn" IS NOT NULL))`)
@Index('IDX_retenciones_cupos_habitacion', ['habitacionId', 'checkin'])
export class RetencionCupos {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_retenciones_cupos' })
  ordenId: string;

  @Column({ type: 'uuid' })
  habitacionId: string;

  @Column({ type: 'date' })
  checkin: string;

  @Column({ type: 'date' })
  checkout: string;

  @Column({ type: 'int' })
  cantidad: number;

  @Column({ type: 'varchar', length: 10, default: EstadoRetencion.RETENIDA })
  estado: EstadoRetencion;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  creadaEn: Date;

  @Column({ type: 'timestamptz', nullable: true })
  liberadaEn: Date | null;

  // Solo las provisionales (saga en curso): pasado este instante, el barrido la libera
  @Column({ type: 'timestamptz', nullable: true })
  venceEn: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmadaEn: Date | null;
}
