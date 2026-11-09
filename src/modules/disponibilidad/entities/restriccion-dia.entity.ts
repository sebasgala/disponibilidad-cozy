import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

// Restricciones de venta de una habitación en una noche (contrato v2, RestriccionesDiaV2). Aplican a todos sus planes.
// Una noche sin fila no restringe nada.
@Entity({ name: 'restricciones_dia', schema: 'disponibilidad' })
@Check(
  'CHK_restricciones_estancia',
  '("estanciaMinima" IS NULL OR "estanciaMinima" BETWEEN 1 AND 30) AND ("estanciaMaxima" IS NULL OR "estanciaMaxima" BETWEEN 1 AND 30) AND ("estanciaMinima" IS NULL OR "estanciaMaxima" IS NULL OR "estanciaMinima" <= "estanciaMaxima")',
)
@Check('CHK_restricciones_anticipacion', '"anticipacionMinimaHoras" IS NULL OR "anticipacionMinimaHoras" BETWEEN 0 AND 8760')
export class RestriccionDia {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_restricciones_dia' })
  habitacionId: string;

  // Fecha sin hora, 'YYYY-MM-DD'
  @PrimaryColumn({ type: 'date', primaryKeyConstraintName: 'PK_restricciones_dia' })
  fecha: string;

  @Column({ type: 'int', nullable: true })
  estanciaMinima: number | null;

  @Column({ type: 'int', nullable: true })
  estanciaMaxima: number | null;

  @Column({ type: 'boolean', default: false })
  cerradoALlegada: boolean;

  @Column({ type: 'boolean', default: false })
  cerradoASalida: boolean;

  @Column({ type: 'boolean', default: false })
  ventaCerrada: boolean;

  @Column({ type: 'int', nullable: true })
  anticipacionMinimaHoras: number | null;
}
