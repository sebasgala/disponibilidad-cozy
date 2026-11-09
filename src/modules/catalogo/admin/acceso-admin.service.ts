import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Alojamiento } from '../entities/alojamiento.entity';
import { Habitacion } from '../entities/habitacion.entity';
import { RolUsuario, UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { ID_MAXIMO, esUuid } from '../../comun/alojamientos-consulta.utils';
import { RecursoNoEncontradoException } from '../../comun/problems/problem-details.exceptions';
import { CONEXION } from '../../../database/conexiones';

// PUNTO ÚNICO de autorización del admin sobre alojamientos, habitaciones y su disponibilidad (las reservas tienen
// el suyo, AccesoReservasService, que pregunta al catálogo de quién es el alojamiento).
//
// - superadmin: ve y modifica todo.
// - administrador: solo lo que pertenece a un alojamiento suyo (alojamiento.propietarioId = su id).
// - Cualquier cosa fuera de su alcance responde 404 NOT_FOUND, igual que si no existiera: así no se revela
//   que existe. (Un 403 le confirmaría que el id es válido.)
//
// El rol ya lo exigió RolesGuard; aquí se decide el alcance sobre cada recurso.
@Injectable()
export class AccesoAdminService {
  constructor(
    @InjectRepository(Alojamiento, CONEXION.catalogo)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Habitacion, CONEXION.catalogo)
    private readonly habitacionesRepository: Repository<Habitacion>,
  ) {}

  // Alojamiento administrable (activo o dado de baja: el admin también ve los inactivos).
  async alojamiento(id: number, usuario: Usuario): Promise<Alojamiento> {
    // Un id fuera del rango de integer haría fallar a PostgreSQL (500); no puede existir.
    const alojamiento =
      id >= 1 && id <= ID_MAXIMO
        ? await this.alojamientosRepository.findOne({ where: { id }, relations: { ciudad: true } })
        : null;
    if (!alojamiento || !this.esAdministrable(alojamiento, usuario)) {
      throw this.noEncontrado(`Alojamiento ${id} no existe`, 'alojamientoId');
    }
    return alojamiento;
  }

  // Habitación administrable (activa o no). El permiso se decide por su alojamiento.
  async habitacion(id: string, usuario: Usuario): Promise<Habitacion> {
    const habitacion = esUuid(id)
      ? await this.habitacionesRepository.findOne({ where: { id }, relations: { alojamiento: true } })
      : null;
    if (!habitacion || !this.esAdministrable(habitacion.alojamiento, usuario)) {
      throw this.noEncontrado(`Habitación ${id} no existe`, 'habitacionId');
    }
    return habitacion;
  }

  // Filtro de listados: undefined = sin filtro (superadmin); si no, solo los alojamientos del administrador.
  propietarioDelFiltro(usuario: Usuario): string | undefined {
    return usuario.rol === RolUsuario.SUPERADMIN ? undefined : usuario.id;
  }

  // Para consultas de TypeORM sobre alojamientos.
  filtroAlojamientos(usuario: Usuario): FindOptionsWhere<Alojamiento> {
    const propietario = this.propietarioDelFiltro(usuario);
    return propietario ? { propietarioId: propietario } : {};
  }

  private esAdministrable(alojamiento: Pick<Alojamiento, 'propietarioId'>, usuario: Usuario): boolean {
    if (usuario.rol === RolUsuario.SUPERADMIN) return true;
    return usuario.rol === RolUsuario.ADMINISTRADOR && alojamiento.propietarioId === usuario.id;
  }

  private noEncontrado(detalle: string, parametro: string): RecursoNoEncontradoException {
    return new RecursoNoEncontradoException(detalle, [{ name: parametro, reason: detalle }]);
  }
}
