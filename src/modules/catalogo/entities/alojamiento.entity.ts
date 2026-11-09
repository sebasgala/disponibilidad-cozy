import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ColumnNumericTransformer } from '../../../common/transformers/column-numeric.transformer';
import { TIPOS_PROPIEDAD } from '../../comun/codigos';
import { Ciudad } from './ciudad.entity';

@Entity({ name: 'alojamientos', schema: 'catalogo' })
@Check('CHK_alojamientos_precio_por_noche', '"precioPorNoche" >= 0')
@Check('CHK_alojamientos_estrellas', '"estrellas" BETWEEN 1 AND 5')
@Check('CHK_alojamientos_tipo_propiedad', `"tipoPropiedad" IN (${TIPOS_PROPIEDAD.map((t) => `'${t}'`).join(', ')})`)
@Check('CHK_alojamientos_coordenadas', '("latitud" IS NULL OR "latitud" BETWEEN -90 AND 90) AND ("longitud" IS NULL OR "longitud" BETWEEN -180 AND 180)')
@Check('CHK_alojamientos_horas', `"checkInDesde" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "checkOutMaxima" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`)
@Unique('UQ_alojamientos_codigo', ['codigo'])
export class Alojamiento {
  // Entero autoincremental: el contrato define accommodation como integer
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  nombre: string;

  @Column({ type: 'varchar', length: 255 })
  destino: string;

  @Column('numeric', {
    precision: 10,
    scale: 2,
    transformer: new ColumnNumericTransformer(),
  })
  precioPorNoche: number;

  @Column({ type: 'int' })
  capacidadAdultos: number;

  @Column({ type: 'int' })
  capacidadNinos: number;

  @Column({ type: 'int' })
  habitaciones: number;

  @Column({ type: 'boolean' })
  tienePiscina: boolean;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  // Código ISO 4217 (ej. 'USD')
  @Column({ type: 'varchar', length: 3, default: 'USD' })
  moneda: string;

  @Index('IX_alojamientos_ciudadId')
  @Column({ type: 'int', nullable: true })
  ciudadId: number | null;

  @ManyToOne(() => Ciudad, { nullable: true })
  @JoinColumn({ name: 'ciudadId' })
  ciudad: Ciudad | null;

  // Administrador dueño del alojamiento. Null = sin dueño (solo lo ve el superadmin).
  @Index('IX_alojamientos_propietarioId')
  @Column({ type: 'uuid', nullable: true })
  propietarioId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  fotos: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  facilidades: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  politicas: Record<string, any> | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  // Código público del contrato v2 (HTL-COZY-UIO-001). Se genera al crear y no cambia (ver codigos.ts).
  @Column({ type: 'varchar', length: 64 })
  codigo: string;

  @Column({ type: 'smallint', default: 3 })
  estrellas: number;

  // HOTEL | RESORT | APARTAMENTO | HOSTAL | HOSTERIA
  @Column({ type: 'varchar', length: 20, default: 'HOTEL' })
  tipoPropiedad: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  direccion: string | null;

  @Column('numeric', { precision: 9, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  latitud: number | null;

  @Column('numeric', { precision: 9, scale: 6, nullable: true, transformer: new ColumnNumericTransformer() })
  longitud: number | null;

  // Hora local (HH:MM) desde la que se permite el check-in y hora máxima de check-out
  @Column({ type: 'varchar', length: 5, default: '14:00' })
  checkInDesde: string;

  @Column({ type: 'varchar', length: 5, default: '11:00' })
  checkOutMaxima: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
