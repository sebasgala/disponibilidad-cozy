import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Stock por avisar a Booking por gRPC (PushStockUpdate), una fila por (habitación, noche). Se escribe en la misma
// transacción que cambia los cupos. Ver v2/stock-outbox.service.ts y v2/stock-envio.worker.ts.
//   PENDIENTE  falta enviarla (a lo sumo una por habitación y noche: lo que se envía es el valor del momento del envío)
//   ENVIADO    Booking la aceptó (también STALE_TIMESTAMP_IGNORED: ya tenía algo más nuevo)
//   RECHAZADO  Booking respondió que no la acepta (ITEM_NOT_FOUND, INVALID_SLOT): no se reintenta, la concilia el inventario
@Entity({ name: 'outbox_stock', schema: 'disponibilidad' })
@Check('CHK_outbox_stock_estado', `"estado" IN ('PENDIENTE', 'ENVIADO', 'RECHAZADO')`)
@Check('CHK_outbox_stock_motivo', `"motivo" IN ('RESERVA', 'CANCELACION', 'INVENTARIO', 'ESTADO')`)
@Index('UQ_outbox_stock_pendiente', ['habitacionId', 'fecha'], { unique: true, where: `"estado" = 'PENDIENTE'` })
@Index('IX_outbox_stock_pendientes', ['proximoIntentoEn'], { where: `"estado" = 'PENDIENTE'` })
export class OutboxStock {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', primaryKeyConstraintName: 'PK_outbox_stock' })
  id: string;

  @Column({ type: 'uuid' })
  habitacionId: string;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'varchar', length: 20 })
  motivo: 'RESERVA' | 'CANCELACION' | 'INVENTARIO' | 'ESTADO';

  @Column({ type: 'uuid', nullable: true })
  ordenId: string | null;

  @Column({ type: 'varchar', length: 12, default: 'PENDIENTE' })
  estado: 'PENDIENTE' | 'ENVIADO' | 'RECHAZADO';

  // Sube cada vez que otro cambio toca la misma noche mientras la fila sigue pendiente: si subió durante un envío,
  // ese envío ya no es el último y la fila sigue pendiente.
  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'int', default: 0 })
  intentos: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  proximoIntentoEn: Date;

  // Arrendamiento mientras un proceso la envía (no se bloquea la fila durante la llamada de red)
  @Column({ type: 'timestamptz', nullable: true })
  enviandoHasta: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  ultimoError: string | null;

  @Column({ type: 'int', nullable: true })
  unidadesEnviadas: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn: Date;

  @Index('IX_outbox_stock_enviadoEn')
  @Column({ type: 'timestamptz', nullable: true })
  enviadoEn: Date | null;
}
