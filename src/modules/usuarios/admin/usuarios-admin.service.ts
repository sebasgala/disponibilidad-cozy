import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { EstadoUsuario, Usuario } from '../entities/usuario.entity';
import { UsuarioResponseDto } from '../dto/auth/auth.dto';
import { CambiarRolDto, FiltroUsuariosQueryDto, UsuariosPaginadosDto } from '../dto/admin/usuario-admin.dto';
import { ConflictoException, RecursoNoEncontradoException } from '../../comun/problems/problem-details.exceptions';
import { esUuid } from '../../comun/alojamientos-consulta.utils';
import { AuditoriaService } from '../../comun/auditoria.service';
import { AuthService } from '../seguridad/auth.service';
import { SesionJwt } from '../seguridad/seguridad.tipos';
import { CONEXION } from '../../../database/conexiones';

// Gestión de cuentas por el superadmin. Todas las acciones son idempotentes: repetir una que ya está
// aplicada devuelve el usuario tal cual (200) y no escribe auditoría.
@Injectable()
export class UsuariosAdminService {
  constructor(
    @InjectRepository(Usuario, CONEXION.usuarios)
    private readonly usuariosRepository: Repository<Usuario>,
    @InjectDataSource(CONEXION.usuarios)
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly authService: AuthService,
  ) {}

  async listar(filtro: FiltroUsuariosQueryDto): Promise<UsuariosPaginadosDto> {
    const pagina = filtro.page ?? 1;
    const limite = filtro.limit ?? 10;
    const where: FindOptionsWhere<Usuario> = {};
    if (filtro.rol) where.rol = filtro.rol;
    if (filtro.estado) where.estado = filtro.estado;
    const [usuarios, total] = await this.usuariosRepository.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (pagina - 1) * limite,
      take: limite,
    });
    return {
      data: usuarios.map((u) => this.authService.aRespuesta(u)),
      meta: { totalItems: total, itemCount: usuarios.length, itemsPerPage: limite, totalPages: Math.ceil(total / limite), currentPage: pagina },
    };
  }

  // pendiente -> activo. Activo: no hace nada. Suspendido: 409 (para eso está "reactivar").
  async aprobar(id: string, actor: SesionJwt): Promise<UsuarioResponseDto> {
    const usuario = await this.buscar(id);
    if (usuario.estado === EstadoUsuario.SUSPENDIDO) {
      throw this.conflicto('La cuenta está suspendida: usa "reactivar"', 'estado');
    }
    return this.cambiarEstado(usuario, EstadoUsuario.ACTIVO, 'aprobar', actor);
  }

  // activo -> suspendido. Suspendido: no hace nada. Pendiente: 409 (no tiene sesión que suspender; se deja pendiente).
  async suspender(id: string, actor: SesionJwt): Promise<UsuarioResponseDto> {
    const usuario = await this.buscar(id);
    if (usuario.id === actor.id) throw this.conflicto('No puedes suspender tu propia cuenta', 'id');
    if (usuario.estado === EstadoUsuario.PENDIENTE) {
      throw this.conflicto('La cuenta está pendiente de aprobación: no hay nada que suspender', 'estado');
    }
    return this.cambiarEstado(usuario, EstadoUsuario.SUSPENDIDO, 'suspender', actor);
  }

  // suspendido -> activo. Activo: no hace nada. Pendiente: 409 (para eso está "aprobar").
  async reactivar(id: string, actor: SesionJwt): Promise<UsuarioResponseDto> {
    const usuario = await this.buscar(id);
    if (usuario.estado === EstadoUsuario.PENDIENTE) {
      throw this.conflicto('La cuenta está pendiente de aprobación: usa "aprobar"', 'estado');
    }
    return this.cambiarEstado(usuario, EstadoUsuario.ACTIVO, 'reactivar', actor);
  }

  async cambiarRol(id: string, dto: CambiarRolDto, actor: SesionJwt): Promise<UsuarioResponseDto> {
    const usuario = await this.buscar(id);
    if (usuario.rol === dto.rol) return this.authService.aRespuesta(usuario);
    if (usuario.id === actor.id) throw this.conflicto('No puedes cambiar tu propio rol', 'id');
    const antes = { rol: usuario.rol };
    usuario.rol = dto.rol;
    await this.guardar(usuario, 'cambiar_rol', antes, { rol: usuario.rol }, actor);
    return this.authService.aRespuesta(usuario);
  }

  // ───────────────────────── Apoyo ─────────────────────────

  private async cambiarEstado(usuario: Usuario, estado: EstadoUsuario, accion: string, actor: SesionJwt): Promise<UsuarioResponseDto> {
    if (usuario.estado !== estado) {
      const antes = { estado: usuario.estado };
      usuario.estado = estado;
      await this.guardar(usuario, accion, antes, { estado }, actor);
    }
    return this.authService.aRespuesta(usuario);
  }

  private guardar(usuario: Usuario, accion: string, antes: Record<string, any>, despues: Record<string, any>, actor: SesionJwt) {
    return this.dataSource.transaction(async (manager) => {
      await manager.save(usuario);
      await this.auditoria.registrar(manager, { modulo: 'usuarios', usuarioId: actor.id, accion, entidad: 'usuario', entidadId: usuario.id, antes, despues });
    });
  }

  private async buscar(id: string): Promise<Usuario> {
    const usuario = esUuid(id) ? await this.usuariosRepository.findOneBy({ id }) : null;
    if (!usuario) {
      const reason = `El usuario ${id} no existe`;
      throw new RecursoNoEncontradoException(reason, [{ name: 'id', reason }]);
    }
    return usuario;
  }

  private conflicto(detalle: string, parametro: string): ConflictoException {
    return new ConflictoException('VALIDATION_FAILED', detalle, [{ name: parametro, reason: detalle }]);
  }
}

