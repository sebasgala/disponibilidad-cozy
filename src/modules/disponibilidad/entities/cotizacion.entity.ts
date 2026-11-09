import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Cotización de POST /api/v2/alojamientos/availability: congela el precio 30 minutos y NO retiene cupo.
// La usa orders/create (fase 4) para honrar el precio cotizado. `desglose` es el DesglosePrecioV2 tal como se devolvió.
@Entity({ name: 'cotizaciones', schema: 'disponibilidad' })
@Check('CHK_cotizaciones_fechas', '"fechaFin" > "fechaInicio"')
@Check('CHK_cotizaciones_habitaciones', '"cantidadHabitaciones" BETWEEN 1 AND 10')
@Check('CHK_cotizaciones_total', '"totalCentavos" >= 0')
@Check('CHK_cotizaciones_vigencia', '"validaHasta" > "creadaEn"')
export class Cotizacion {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_cotizaciones' })
  id: string;

  @Index('IX_cotizaciones_alojamientoId')
  @Column({ type: 'int' })
  alojamientoId: number;

  @Index('IX_cotizaciones_habitacionId')
  @Column({ type: 'uuid' })
  habitacionId: string;

  @Column({ type: 'varchar', length: 30 })
  planTarifaCodigo: string;

  @Column({ type: 'date' })
  fechaInicio: string;

  @Column({ type: 'date' })
  fechaFin: string;

  @Column({ type: 'int' })
  cantidadHabitaciones: number;

  @Column({ type: 'jsonb' })
  ocupantes: { adultos: number; ninos: number; edadesNinos?: number[] };

  // Plan con el que se cotizó (régimen, modelo de pago, política): no cambia aunque luego se edite el plan
  @Column({ type: 'jsonb' })
  plan: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  desglose: Record<string, unknown>;

  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) } })
  totalCentavos: number;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  moneda: string;

  @Column({ type: 'timestamptz' })
  creadaEn: Date;

  @Index('IX_cotizaciones_validaHasta')
  @Column({ type: 'timestamptz' })
  validaHasta: Date;

  // La marca la orden que usa esta cotización (fase 8.0): la limpieza conserva las usadas sin consultar las órdenes
  @Column({ type: 'timestamptz', nullable: true })
  usadaEn: Date | null;
}
