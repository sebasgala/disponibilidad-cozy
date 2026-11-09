import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Habitacion } from '../entities/habitacion.entity';
import { UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import {
  ActualizarHabitacionDto,
  CrearHabitacionDto,
  FiltroHabitacionesQueryDto,
  HabitacionAdminResponseDto,
} from '../dto/admin/habitacion-admin.dto';
import { ConsultaInvalidaException } from '../../comun/problems/problem-details.exceptions';
import { BusCatalogoService } from '../bus-catalogo.service';
import { AuditoriaService } from '../../comun/auditoria.service';
import { AccesoAdminService } from './acceso-admin.service';
import { ConsultaReservasVigentes, exigirSinReservasVigentes } from '../reservas-vigentes.puerto';
import { codigoHabitacion } from '../../comun/codigos';
import { CONEXION } from '../../../database/conexiones';

// En PATCH estos campos no pueden venir en null (las columnas son NOT NULL).
const CAMPOS_NO_NULOS: (keyof ActualizarHabitacionDto)[] = ['nombre', 'tipo', 'capacidadAdultos', 'capacidadNinos', 'precioBase'];

const CAMPOS_AUDITADOS = ['nombre', 'tipo', 'capacidadAdultos', 'capacidadNinos', 'precioBase', 'mealPlan', 'cancellationType', 'activo', 'codigo', 'descripcion', 'camas', 'metrosCuadrados', 'fotos', 'amenidades'] as const;
const foto = (h: Habitacion) => Object.fromEntries(CAMPOS_AUDITADOS.map((campo) => [campo, h[campo]]));

// CRUD interno de habitaciones. Nunca borra filas: desactivar es borrado lógico (activo = false), y no toca
// órdenes ni disponibilidad. Crear una habitación no crea disponibilidad. Cada cambio escribe su fila de
// auditoría en la misma transacción.
@Injectable()
export class HabitacionesAdminService {
  constructor(
    @InjectRepository(Habitacion, CONEXION.catalogo)
    private readonly habitacionesRepository: Repository<Habitacion>,
    @InjectDataSource(CONEXION.catalogo)
    private readonly dataSource: DataSource,
    private readonly acceso: AccesoAdminService,
    private readonly auditoria: AuditoriaService,
    private readonly bus: BusCatalogoService,
    private readonly reservasVigentes: ConsultaReservasVigentes,
  ) {}

  async listar(alojamientoId: number, filtro: FiltroHabitacionesQueryDto, usuario: Usuario): Promise<HabitacionAdminResponseDto[]> {
    const alojamiento = await this.acceso.alojamiento(alojamientoId, usuario);
    const where: FindOptionsWhere<Habitacion> = { alojamientoId: alojamiento.id };
    if (!filtro.incluirInactivas) where.activo = true;
    const habitaciones = await this.habitacionesRepository.find({ where, order: { nombre: 'ASC' } });
    return habitaciones.map((h) => this.aRespuesta(h));
  }

  async crear(alojamientoId: number, dto: CrearHabitacionDto, usuario: Usuario): Promise<HabitacionAdminResponseDto> {
    const alojamiento = await this.acceso.alojamiento(alojamientoId, usuario);
    const nueva = await this.dataSource.transaction(async (manager) => {
      const existentes = await manager.find(Habitacion, { where: { alojamientoId: alojamiento.id }, select: { codigo: true } });
      const guardada = await manager.save(
        manager.create(Habitacion, {
          alojamientoId: alojamiento.id,
          nombre: dto.nombre,
          tipo: dto.tipo,
          capacidadAdultos: dto.capacidadAdultos,
          capacidadNinos: dto.capacidadNinos,
          precioBase: dto.precioBase,
          mealPlan: dto.mealPlan ?? null,
          cancellationType: dto.cancellationType ?? null,
          activo: true,
          codigo: codigoHabitacion(dto.nombre, existentes.map((e) => e.codigo)),
          descripcion: dto.descripcion ?? null,
          camas: dto.camas ?? null,
          metrosCuadrados: dto.metrosCuadrados ?? null,
          fotos: dto.fotos ?? null,
          amenidades: dto.amenidades ?? null,
        }),
      );
      await this.auditoria.registrar(manager, {
        modulo: 'catalogo',
        usuarioId: usuario.id,
        accion: 'crear',
        entidad: 'habitacion',
        entidadId: guardada.id,
        despues: { alojamientoId: alojamiento.id, ...foto(guardada) },
      });
      return guardada;
    });
    return this.aRespuesta(nueva);
  }

  async obtener(id: string, usuario: Usuario): Promise<HabitacionAdminResponseDto> {
    return this.aRespuesta(await this.acceso.habitacion(id, usuario));
  }

  async actualizar(id: string, dto: ActualizarHabitacionDto, usuario: Usuario): Promise<HabitacionAdminResponseDto> {
    const habitacion = await this.acceso.habitacion(id, usuario);
    const nulos = CAMPOS_NO_NULOS.filter((campo) => dto[campo] === null);
    if (nulos.length > 0) {
      throw new ConsultaInvalidaException(nulos.map((campo) => ({ name: campo, reason: 'no puede ser null' })));
    }
    const antes = foto(habitacion);
    const enviados = Object.fromEntries(Object.entries(dto).filter(([, valor]) => valor !== undefined));
    Object.assign(habitacion, enviados);
    const guardada = await this.dataSource.transaction(async (manager) => {
      const g = await manager.save(habitacion);
      await this.auditoria.registrar(manager, {
        modulo: 'catalogo',
        usuarioId: usuario.id,
        accion: 'actualizar',
        entidad: 'habitacion',
        entidadId: g.id,
        antes,
        despues: foto(g),
      });
      return g;
    });
    return this.aRespuesta(guardada);
  }

  // Desactivar y reactivar son idempotentes: repetirlos no da error ni escribe auditoría.
  // Desactivar con reservas confirmadas vigentes da 409: hay que cancelarlas primero.
  async cambiarEstado(id: string, activo: boolean, usuario: Usuario): Promise<HabitacionAdminResponseDto> {
    const habitacion = await this.acceso.habitacion(id, usuario);
    if (habitacion.activo !== activo) {
      // Reservas vigentes: se pregunta a reservas antes de abrir la transacción del catálogo (8.4, E3)
      if (!activo) await exigirSinReservasVigentes(this.reservasVigentes, { habitacionId: habitacion.id }, 'la habitación');
      await this.dataSource.transaction(async (manager) => {
        await manager.update(Habitacion, { id: habitacion.id }, { activo });
        await this.auditoria.registrar(manager, {
          modulo: 'catalogo',
          usuarioId: usuario.id,
          accion: activo ? 'reactivar' : 'desactivar',
          entidad: 'habitacion',
          entidadId: habitacion.id,
          antes: { activo: habitacion.activo },
          despues: { activo },
        });
        // Dar de baja o reactivar cambia el stock que ve Booking en todas las noches futuras (0 mientras esté de baja):
        // se publica el evento y disponibilidad avisa a Booking (fase 8.0)
        await this.bus.publicar(manager, 'catalogo.habitacion.estado_cambiado', { habitacionId: habitacion.id, activo });
      });
      habitacion.activo = activo;
    }
    return this.aRespuesta(habitacion);
  }

  private aRespuesta(h: Habitacion): HabitacionAdminResponseDto {
    const base = `/api/v1/admin/habitaciones/${h.id}`;
    return {
      id: h.id,
      alojamientoId: h.alojamientoId,
      nombre: h.nombre,
      tipo: h.tipo,
      capacidadAdultos: h.capacidadAdultos,
      capacidadNinos: h.capacidadNinos,
      precioBase: h.precioBase,
      mealPlan: h.mealPlan,
      cancellationType: h.cancellationType,
      activo: h.activo,
      codigo: h.codigo,
      descripcion: h.descripcion,
      camas: h.camas,
      metrosCuadrados: h.metrosCuadrados,
      fotos: h.fotos,
      amenidades: h.amenidades,
      _links: {
        self: base,
        alojamiento: `/api/v1/admin/alojamientos/${h.alojamientoId}`,
        disponibilidad: `${base}/disponibilidad`,
        [h.activo ? 'desactivar' : 'reactivar']: `${base}/${h.activo ? 'desactivar' : 'reactivar'}`,
      },
    };
  }
}
