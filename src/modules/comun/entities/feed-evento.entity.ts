import { Check, Column, CreateDateColumn, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

export const TIPOS_EVENTO = [
  'alojamiento.reserva.confirmada',
  'alojamiento.reserva.cancelada',
  'alojamiento.checkin.completado',
  'alojamiento.checkout.completado',
  'alojamiento.stock.actualizado',
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

// Feed de eventos del contrato v2 (GET /alojamientos/eventos), en formato CloudEvents. Los eventos y el stock no
// llevan datos personales (LOPDP, §7.1): solo identificadores y cifras. Lo escribe SOLO el publicador
// (v2/publicador-eventos.service.ts), que copia aquí lo que los dominios dejan en sus outbox y asigna `sequence` sin saltos.
@Entity({ name: 'feed_eventos', schema: 'comun' })
@Unique('UQ_feed_eventos_id', ['id'])
@Check('CHK_feed_eventos_sequence', '"sequence" >= 1')
@Check('CHK_feed_eventos_tipo', `"tipo" IN (${TIPOS_EVENTO.map((t) => `'${t}'`).join(', ')})`)
@Index('IX_feed_eventos_tipo', ['tipo', 'sequence'])
@Index('IX_feed_eventos_alojamientoId', ['alojamientoId', 'sequence'])
export class FeedEvento {
  @PrimaryColumn({ type: 'bigint', primaryKeyConstraintName: 'PK_feed_eventos', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  sequence: number;

  @Column({ type: 'uuid' })
  id: string;

  @Column({ type: 'varchar', length: 60 })
  tipo: TipoEvento;

  @Column({ type: 'varchar', length: 200 })
  sujeto: string;

  @Column({ type: 'int', nullable: true })
  alojamientoId: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  correlacionId: string | null;

  @Column({ type: 'jsonb' })
  datos: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn: Date;
}
