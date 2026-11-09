import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'ciudades', schema: 'catalogo' })
@Unique(['nombre', 'pais'])
export class Ciudad {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  // Código ISO 3166-1 alpha-2 en minúsculas (ej. 'ec')
  @Column({ type: 'varchar', length: 2 })
  pais: string;
}
