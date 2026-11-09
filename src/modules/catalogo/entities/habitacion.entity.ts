import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { Alojamiento } from './alojamiento.entity';

// Es el "product" del contrato: su id (UUID) viaja dentro del product_id (texto).
@Entity({ name: 'habitaciones', schema: 'catalogo' })
@Check('CHK_habitaciones_precio_base', '"precioBase" >= 0')
@Check('CHK_habitaciones_codigo', `"codigo" ~ '^[A-Z0-9_]{2,40}$'`)
@Check('CHK_habitaciones_metros', '"metrosCuadrados" IS NULL OR "metrosCuadrados" > 0')
@Unique('UQ_habitaciones_alojamiento_codigo', ['alojamientoId', 'codigo'])
export class Habitacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IX_habitaciones_alojamientoId')
  @Column({ type: 'int' })
  alojamientoId: number;

  @ManyToOne(() => Alojamiento, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alojamientoId' })
  alojamiento: Alojamiento;

  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'varchar', length: 100 })
  tipo: string;

  @Column({ type: 'int' })
  capacidadAdultos: number;

  @Column({ type: 'int' })
  capacidadNinos: number;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioBase: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mealPlan: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cancellationType: string | null;

  // Borrado lógico: una habitación inactiva no aparece en /search, /availability, /details ni en el preview.
  // Las órdenes que ya la tienen se siguen pudiendo consultar y cancelar.
  @Column({ type: 'boolean', default: true })
  activo: boolean;

  // Código del tipo de habitación en el contrato v2 (SUITE_DELUXE). Único por alojamiento; no cambia (ver codigos.ts).
  @Column({ type: 'varchar', length: 40 })
  codigo: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  camas: string | null;

  @Column({ type: 'int', nullable: true })
  metrosCuadrados: number | null;

  @Column({ type: 'jsonb', nullable: true })
  fotos: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  amenidades: string[] | null;
}
