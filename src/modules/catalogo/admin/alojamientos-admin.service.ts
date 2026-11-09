import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { BusCatalogoService } from '../bus-catalogo.service';
import { AuditoriaService } from '../../comun/auditoria.service';
import { Alojamiento } from '../entities/alojamiento.entity';
import { Ciudad } from '../entities/ciudad.entity';
import { Habitacion } from '../entities/habitacion.entity';
import { CreateAlojamientoDto } from '../dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from '../dto/update-alojamiento.dto';
import { FiltroAlojamientosQueryDto } from '../dto/filtro-alojamientos-query.dto';
import { AlojamientoResponseDto, PaginatedAlojamientosResponseDto } from '../dto/alojamiento-response.dto';
import { ConsultaInvalidaException } from '../../comun/problems/problem-details.exceptions';
import { AccesoAdminService } from './acceso-admin.service';
import { ConsultaReservasVigentes, exigirSinReservasVigentes } from '../reservas-vigentes.puerto';
import { codigoAlojamiento } from '../../comun/codigos';
import { CONEXION } from '../../../database/conexiones';

// En PATCH estos campos no pueden venir en null (las columnas son NOT NULL)
const CAMPOS_NO_NULOS: (keyof UpdateAlojamientoDto)[] = [
  'nombre',
  'ciudadId',
  'moneda',
  'precioPorNoche',
  'capacidadAdultos',
  'capacidadNinos',
  'tienePiscina',
  'activo',
  'estrellas',
  'tipoPropiedad',
];

// Servicio del CRUD de administración (rutas /admin/alojamientos). Es aparte del servicio del contrato.
@Injectable()
export class AlojamientosAdminService {
  constructor(
    @InjectRepository(Alojamiento, CONEXION.catalogo)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Ciudad, CONEXION.catalogo)
    private readonly ciudadesRepository: Repository<Ciudad>,
    @InjectRepository(Habitacion, CONEXION.catalogo)
    private readonly habitacionesRepository: Repository<Habitacion>,
    @InjectDataSource(CONEXION.catalogo)
    private readonly dataSource: DataSource,
    private readonly acceso: AccesoAdminService,
    private readonly auditoria: AuditoriaService,
    private readonly bus: BusCatalogoService,
    private readonly reservasVigentes: ConsultaReservasVigentes,
  ) {}

  async findAll(query: FiltroAlojamientosQueryDto, usuario: Usuario): Promise<PaginatedAlojamientosResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    // El administrador solo lista los suyos; el superadmin, todos.
    const where: FindOptionsWhere<Alojamiento> = { ...this.acceso.filtroAlojamientos(usuario) };
    if (query.ciudadId !== undefined) where.ciudadId = query.ciudadId;
    if (query.activo !== undefined) where.activo = query.activo;

    const [alojamientos, totalItems] = await this.alojamientosRepository.findAndCount({
      where,
      relations: { ciudad: true },
      order: { id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const conteo = await this.contarHabitaciones(alojamientos.map((a) => a.id), query.incluirInactivas);

    const totalPages = Math.ceil(totalItems / limit);
    const ultima = Math.max(totalPages, 1);
    const enlace = (numero: number) => {
      const params = new URLSearchParams({ page: String(numero), limit: String(limit) });
      if (query.ciudadId !== undefined) params.set('ciudadId', String(query.ciudadId));
      if (query.activo !== undefined) params.set('activo', String(query.activo));
      if (query.incluirInactivas !== undefined) params.set('incluirInactivas', String(query.incluirInactivas));
      return `/api/v1/admin/alojamientos?${params.toString()}`;
    };

    return {
      data: alojamientos.map((a) => this.aRespuesta(a, conteo.get(a.id) ?? 0)),
      meta: {
        totalItems,
        itemCount: alojamientos.length,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
      },
      _links: {
        first: enlace(1),
        ...(page > 1 && { previous: enlace(Math.min(page - 1, ultima)) }),
        ...(page < totalPages && { next: enlace(page + 1) }),
        last: enlace(ultima),
      },
    };
  }

  // Devuelve también los alojamientos dados de baja: el admin puede verlos.
  async findOne(id: number, usuario: Usuario, incluirInactivas = false): Promise<AlojamientoResponseDto> {
    const alojamiento = await this.buscarEntidad(id, usuario);
    const conteo = await this.contarHabitaciones([id], incluirInactivas);
    return this.aRespuesta(alojamiento, conteo.get(id) ?? 0);
  }

  // El creador queda como propietario (también si es superadmin).
  async crear(dto: CreateAlojamientoDto, usuario: Usuario): Promise<AlojamientoResponseDto> {
    const ciudad = await this.obtenerCiudad(dto.ciudadId);
    const nuevo = this.alojamientosRepository.create({
      nombre: dto.nombre,
      ciudadId: ciudad.id,
      destino: ciudad.nombre,
      descripcion: dto.descripcion ?? null,
      moneda: dto.moneda ?? 'USD',
      precioPorNoche: dto.precioPorNoche,
      capacidadAdultos: dto.capacidadAdultos,
      capacidadNinos: dto.capacidadNinos,
      habitaciones: 0, // columna de respaldo; el valor real se calcula al responder
      tienePiscina: dto.tienePiscina,
      fotos: dto.fotos ?? null,
      facilidades: dto.facilidades ?? null,
      politicas: dto.politicas ?? null,
      activo: dto.activo ?? true,
      propietarioId: usuario.id,
      estrellas: dto.estrellas ?? 3,
      tipoPropiedad: dto.tipoPropiedad ?? 'HOTEL',
      direccion: dto.direccion ?? null,
      latitud: dto.latitud ?? null,
      longitud: dto.longitud ?? null,
    });
    const guardado = await this.dataSource.transaction(async (manager) => {
      // El código lleva el id, así que se reserva antes de insertar (la columna es NOT NULL).
      const [{ id }] = await manager.query(`SELECT nextval(pg_get_serial_sequence('catalogo.alojamientos', 'id'))::int AS id`);
      nuevo.id = id;
      nuevo.codigo = codigoAlojamiento(id, ciudad.nombre);
      const g = await manager.save(nuevo);
      await this.auditoria.registrar(manager, {
        modulo: 'catalogo',
        usuarioId: usuario.id,
        accion: 'crear',
        entidad: 'alojamiento',
        entidadId: g.id,
        despues: this.foto(g),
      });
      return g;
    });
    return this.findOne(guardado.id, usuario);
  }

  // PUT: reemplazo completo. Lo que no se envía vuelve a su valor por defecto,
  // salvo `activo`, que se conserva si no se envía (el estado no es parte del contenido).
  async reemplazar(id: number, dto: CreateAlojamientoDto, usuario: Usuario): Promise<void> {
    const alojamiento = await this.buscarEntidad(id, usuario);
    const antes = this.foto(alojamiento);
    const ciudad = await this.obtenerCiudad(dto.ciudadId);

    Object.assign(alojamiento, {
      nombre: dto.nombre,
      ciudadId: ciudad.id,
      ciudad,
      destino: ciudad.nombre,
      descripcion: dto.descripcion ?? null,
      moneda: dto.moneda ?? 'USD',
      precioPorNoche: dto.precioPorNoche,
      capacidadAdultos: dto.capacidadAdultos,
      capacidadNinos: dto.capacidadNinos,
      tienePiscina: dto.tienePiscina,
      fotos: dto.fotos ?? null,
      facilidades: dto.facilidades ?? null,
      politicas: dto.politicas ?? null,
      estrellas: dto.estrellas ?? 3,
      tipoPropiedad: dto.tipoPropiedad ?? 'HOTEL',
      direccion: dto.direccion ?? null,
      latitud: dto.latitud ?? null,
      longitud: dto.longitud ?? null,
    });
    if (dto.activo !== undefined && dto.activo !== null) alojamiento.activo = dto.activo;

    await this.guardarConAuditoria(alojamiento, 'reemplazar', antes, usuario);
  }

  // PATCH: solo cambia los campos enviados.
  async actualizar(id: number, dto: UpdateAlojamientoDto, usuario: Usuario): Promise<AlojamientoResponseDto> {
    const alojamiento = await this.buscarEntidad(id, usuario);
    const antes = this.foto(alojamiento);

    const nulos = CAMPOS_NO_NULOS.filter((campo) => dto[campo] === null);
    if (nulos.length > 0) {
      throw new ConsultaInvalidaException(nulos.map((campo) => ({ name: campo, reason: 'no puede ser null' })));
    }

    const { ciudadId, ...resto } = dto;
    if (ciudadId !== undefined) {
      const ciudad = await this.obtenerCiudad(ciudadId);
      alojamiento.ciudadId = ciudad.id;
      alojamiento.ciudad = ciudad;
      alojamiento.destino = ciudad.nombre;
    }
    const enviados = Object.fromEntries(Object.entries(resto).filter(([, valor]) => valor !== undefined));
    Object.assign(alojamiento, enviados);

    await this.guardarConAuditoria(alojamiento, 'actualizar', antes, usuario);
    return this.findOne(id, usuario);
  }

  // Borrado lógico: no elimina la fila, solo pone activo = false. Repetirlo no da error.
  async desactivar(id: number, usuario: Usuario): Promise<void> {
    const alojamiento = await this.buscarEntidad(id, usuario);
    if (alojamiento.activo) {
      const antes = this.foto(alojamiento);
      alojamiento.activo = false;
      await this.guardarConAuditoria(alojamiento, 'desactivar', antes, usuario);
    }
  }

  // ───────────────────────── Apoyo ─────────────────────────

  // Pasa por el punto único de acceso del admin: comprueba que el alojamiento sea del usuario.
  private buscarEntidad(id: number, usuario: Usuario): Promise<Alojamiento> {
    return this.acceso.alojamiento(id, usuario);
  }

  // Guarda y escribe la fila de auditoría en la misma transacción.
  // Si el alojamiento pasa de activo a inactivo (DELETE, o PATCH/PUT con activo=false): 409 si tiene reservas
  // confirmadas vigentes; si no, también se desactivan sus habitaciones (la disponibilidad se conserva: una
  // habitación inactiva no se vende). Al reactivar el alojamiento, las habitaciones se reactivan una por una.
  private async guardarConAuditoria(alojamiento: Alojamiento, accion: string, antes: Record<string, any>, usuario: Usuario) {
    // Reservas vigentes: se pregunta a reservas antes de abrir la transacción del catálogo (8.4, E3)
    if (antes.activo && !alojamiento.activo) await exigirSinReservasVigentes(this.reservasVigentes, { alojamientoId: alojamiento.id }, 'el alojamiento');
    return this.dataSource.transaction(async (manager) => {
      if (antes.activo && !alojamiento.activo) {
        const activas = await manager.find(Habitacion, { where: { alojamientoId: alojamiento.id, activo: true }, select: { id: true } });
        if (activas.length > 0) {
          await manager.update(Habitacion, { alojamientoId: alojamiento.id, activo: true }, { activo: false });
          for (const h of activas) {
            await this.auditoria.registrar(manager, {
              modulo: 'catalogo',
              usuarioId: usuario.id,
              accion: 'desactivar',
              entidad: 'habitacion',
              entidadId: h.id,
              antes: { activo: true },
              despues: { activo: false, motivo: 'baja del alojamiento' },
            });
          }
        }
      }
      await manager.save(alojamiento);
      await this.auditoria.registrar(manager, {
        modulo: 'catalogo',
        usuarioId: usuario.id,
        accion,
        entidad: 'alojamiento',
        entidadId: alojamiento.id,
        antes,
        despues: this.foto(alojamiento),
      });
      // Un alojamiento dado de baja (o reactivado) cambia el stock de todas sus habitaciones: se publica el evento y
      // disponibilidad avisa a Booking (fase 8.0: el catálogo ya no escribe en la outbox de stock)
      if (antes.activo !== alojamiento.activo) {
        const habitaciones = await manager.find(Habitacion, { where: { alojamientoId: alojamiento.id }, select: { id: true } });
        await this.bus.publicar(manager, 'catalogo.alojamiento.estado_cambiado', {
          alojamientoId: alojamiento.id,
          activo: alojamiento.activo,
          habitacionIds: habitaciones.map((h) => h.id),
        });
      }
    });
  }

  private foto(a: Alojamiento): Record<string, any> {
    const { nombre, ciudadId, descripcion, moneda, precioPorNoche, capacidadAdultos, capacidadNinos, tienePiscina, fotos, facilidades, politicas, activo, propietarioId, estrellas, tipoPropiedad, direccion, latitud, longitud } = a;
    return { nombre, ciudadId, descripcion, moneda, precioPorNoche, capacidadAdultos, capacidadNinos, tienePiscina, fotos, facilidades, politicas, activo, propietarioId, estrellas, tipoPropiedad, direccion, latitud, longitud };
  }

  private async obtenerCiudad(ciudadId: number): Promise<Ciudad> {
    const ciudad = await this.ciudadesRepository.findOneBy({ id: ciudadId });
    if (!ciudad) throw new ConsultaInvalidaException([{ name: 'ciudadId', reason: `la ciudad ${ciudadId} no existe` }]);
    return ciudad;
  }

  // Cuenta las habitaciones de varios alojamientos con una sola consulta: solo las activas, salvo que se pida.
  private async contarHabitaciones(ids: number[], incluirInactivas = false): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const consulta = this.habitacionesRepository
      .createQueryBuilder('h')
      .select('h.alojamientoId', 'alojamientoId')
      .addSelect('COUNT(*)', 'total')
      .where('h.alojamientoId IN (:...ids)', { ids });
    if (!incluirInactivas) consulta.andWhere('h.activo = true');
    const filas = await consulta
      .groupBy('h.alojamientoId')
      .getRawMany<{ alojamientoId: number; total: string }>();
    return new Map(filas.map((f) => [Number(f.alojamientoId), Number(f.total)]));
  }

  private aRespuesta(a: Alojamiento, habitaciones: number): AlojamientoResponseDto {
    return {
      id: a.id,
      nombre: a.nombre,
      destino: a.destino,
      ciudadId: a.ciudadId,
      ciudad: a.ciudad ? { id: a.ciudad.id, nombre: a.ciudad.nombre, pais: a.ciudad.pais } : null,
      descripcion: a.descripcion,
      moneda: a.moneda,
      precioPorNoche: a.precioPorNoche,
      capacidadAdultos: a.capacidadAdultos,
      capacidadNinos: a.capacidadNinos,
      habitaciones,
      tienePiscina: a.tienePiscina,
      fotos: a.fotos,
      facilidades: a.facilidades,
      politicas: a.politicas,
      activo: a.activo,
      updatedAt: a.updatedAt,
      codigo: a.codigo,
      estrellas: a.estrellas,
      tipoPropiedad: a.tipoPropiedad,
      direccion: a.direccion,
      latitud: a.latitud,
      longitud: a.longitud,
      _links: { self: `/api/v1/admin/alojamientos/${a.id}`, habitaciones: `/api/v1/admin/alojamientos/${a.id}/habitaciones` },
    };
  }
}
