import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum RolUsuario {
  CLIENTE = 'cliente',
  ADMINISTRADOR = 'administrador',
  SUPERADMIN = 'superadmin',
}

export enum EstadoUsuario {
  PENDIENTE = 'pendiente',
  ACTIVO = 'activo',
  SUSPENDIDO = 'suspendido',
}

// Cuenta de acceso. NUNCA se devuelve tal cual en una respuesta: tiene passwordHash.
// Esquema propio del dominio usuarios (fase 8.1): nadie más lee esta tabla.
@Entity({ name: 'usuarios', schema: 'usuarios' })
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Siempre en minúsculas (se normaliza al guardar), así el único no distingue mayúsculas.
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  // Hash bcrypt (coste 12); mide 60 caracteres.
  @Column({ type: 'varchar', length: 100 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'varchar', length: 120 })
  apellido: string;

  @Column({ type: 'enum', enum: RolUsuario, default: RolUsuario.CLIENTE })
  rol: RolUsuario;

  // Los administradores nacen 'pendiente' hasta que el superadmin los aprueba; los clientes nacen 'activo'.
  @Column({ type: 'enum', enum: EstadoUsuario, default: EstadoUsuario.ACTIVO })
  estado: EstadoUsuario;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
