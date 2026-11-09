import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { AuditoriaService } from '../../comun/auditoria.service';
import { Ciudad } from '../entities/ciudad.entity';
import { CreateCiudadDto } from '../dto/create-ciudad.dto';
import { ConflictoException } from '../../comun/problems/problem-details.exceptions';
import { CONEXION } from '../../../database/conexiones';

@Injectable()
export class CiudadesService {
  constructor(
    @InjectRepository(Ciudad, CONEXION.catalogo)
    private readonly ciudadesRepository: Repository<Ciudad>,
    @InjectDataSource(CONEXION.catalogo)
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  findAll(): Promise<Ciudad[]> {
    return this.ciudadesRepository.find({ order: { nombre: 'ASC', pais: 'ASC' } });
  }

  async crear(dto: CreateCiudadDto, usuario: Usuario): Promise<Ciudad> {
    // La restricción única de la BD distingue mayúsculas; aquí se evita también "quito" vs "Quito".
    const existente = await this.ciudadesRepository
      .createQueryBuilder('c')
      .where('LOWER(c.nombre) = LOWER(:nombre)', { nombre: dto.nombre })
      .andWhere('c.pais = :pais', { pais: dto.pais })
      .getOne();
    if (existente) {
      const reason = `La ciudad "${existente.nombre}" (${existente.pais}) ya existe`;
      throw new ConflictoException('VALIDATION_FAILED', reason, [{ name: 'nombre', reason }]);
    }
    return this.dataSource.transaction(async (manager) => {
      const guardada = await manager.save(manager.create(Ciudad, dto));
      await this.auditoria.registrar(manager, {
        modulo: 'catalogo',
        usuarioId: usuario.id,
        accion: 'crear',
        entidad: 'ciudad',
        entidadId: guardada.id,
        despues: { nombre: guardada.nombre, pais: guardada.pais },
      });
      return guardada;
    });
  }
}
