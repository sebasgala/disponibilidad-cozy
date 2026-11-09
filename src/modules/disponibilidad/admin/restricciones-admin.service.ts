import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource } from 'typeorm';
import { EditarRestriccionesDto, RestriccionDiaAdminDto, RestriccionesAdminResponseDto } from '../dto/admin/planes-restricciones-admin.dto';
import { RestriccionDia } from '../entities/restriccion-dia.entity';
import { UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { ConsultaInvalidaException } from '../../comun/problems/problem-details.exceptions';
import { AuditoriaService } from '../../comun/auditoria.service';
import { CatalogoPuerto } from '../../catalogo/catalogo.puerto';
import { diasDelRango, validarRango } from './disponibilidad-admin.service';
import { CONEXION } from '../../../database/conexiones';

const CAMPOS = ['estanciaMinima', 'estanciaMaxima', 'cerradoALlegada', 'cerradoASalida', 'ventaCerrada', 'anticipacionMinimaHoras'] as const;

const aDia = (r: RestriccionDia): RestriccionDiaAdminDto => ({
  fecha: r.fecha,
  estanciaMinima: r.estanciaMinima,
  estanciaMaxima: r.estanciaMaxima,
  cerradoALlegada: r.cerradoALlegada,
  cerradoASalida: r.cerradoASalida,
  ventaCerrada: r.ventaCerrada,
  anticipacionMinimaHoras: r.anticipacionMinimaHoras,
});

// Una noche sin ninguna restricción equivale a no tener fila
const sinRestricciones = (r: RestriccionDia) =>
  !r.estanciaMinima && !r.estanciaMaxima && !r.cerradoALlegada && !r.cerradoASalida && !r.ventaCerrada && !r.anticipacionMinimaHoras;

// Restricciones de venta por noche de una habitación (/admin/habitaciones/{id}/restricciones), las que evalúa
// POST /api/v2/alojamientos/availability (MIN_STAY, MAX_STAY, CLOSED_TO_ARRIVAL, CLOSED_TO_DEPARTURE, STOP_SELL, CUTOFF).
@Injectable()
export class RestriccionesAdminService {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly catalogo: CatalogoPuerto,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(habitacionId: string, desde: string, hasta: string, usuario: Usuario): Promise<RestriccionesAdminResponseDto> {
    validarRango(desde, hasta);
    const habitacion = await this.catalogo.habitacionAdministrable(habitacionId, usuario);
    const filas = await this.dataSource.getRepository(RestriccionDia).find({ where: { habitacionId: habitacion.id, fecha: Between(desde, hasta) }, order: { fecha: 'ASC' } });
    return { habitacionId: habitacion.id, desde, hasta, data: filas.map(aDia), _links: { self: `/api/v1/admin/habitaciones/${habitacion.id}/restricciones?desde=${desde}&hasta=${hasta}` } };
  }

  // Todo o nada: cambia solo los campos enviados en cada noche del rango (o de los días de la semana pedidos)
  async editar(habitacionId: string, dto: EditarRestriccionesDto, usuario: Usuario): Promise<RestriccionesAdminResponseDto> {
    validarRango(dto.desde, dto.hasta);
    const cambios = Object.fromEntries(CAMPOS.filter((c) => dto[c] !== undefined).map((c) => [c, dto[c]]));
    if (Object.keys(cambios).length === 0) {
      throw new ConsultaInvalidaException([{ name: 'estanciaMinima', reason: 'envía al menos una restricción para cambiar' }]);
    }
    for (const c of ['cerradoALlegada', 'cerradoASalida', 'ventaCerrada'] as const) {
      if (cambios[c] === null) throw new ConsultaInvalidaException([{ name: c, reason: 'no puede ser null (usa false)' }]);
    }
    const habitacion = await this.catalogo.habitacionAdministrable(habitacionId, usuario);
    const fechas = diasDelRango(dto.desde, dto.hasta)
      .filter((d) => !dto.diasSemana || dto.diasSemana.includes(d.diaSemana))
      .map((d) => d.fecha);
    if (fechas.length === 0) throw new ConsultaInvalidaException([{ name: 'diasSemana', reason: 'ningún día del rango cae en esos días de la semana' }]);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RestriccionDia);
      const existentes = new Map((await repo.find({ where: { habitacionId: habitacion.id, fecha: Between(dto.desde, dto.hasta) } })).map((r) => [r.fecha, r]));
      const guardar: RestriccionDia[] = [];
      const borrar: string[] = [];
      for (const fecha of fechas) {
        const fila = existentes.get(fecha) ?? repo.create({ habitacionId: habitacion.id, fecha, cerradoALlegada: false, cerradoASalida: false, ventaCerrada: false, estanciaMinima: null, estanciaMaxima: null, anticipacionMinimaHoras: null });
        Object.assign(fila, cambios);
        if (fila.estanciaMinima && fila.estanciaMaxima && fila.estanciaMinima > fila.estanciaMaxima) {
          throw new ConsultaInvalidaException([{ name: 'estanciaMinima', reason: `el ${fecha} la estancia mínima (${fila.estanciaMinima}) quedaría mayor que la máxima (${fila.estanciaMaxima})` }]);
        }
        if (sinRestricciones(fila)) {
          if (existentes.has(fecha)) borrar.push(fecha);
        } else guardar.push(fila);
      }
      if (guardar.length) await repo.save(guardar);
      for (const fecha of borrar) await repo.delete({ habitacionId: habitacion.id, fecha });
      await this.auditoria.registrar(manager, {
        modulo: 'disponibilidad',
        usuarioId: usuario.id,
        accion: 'editar',
        entidad: 'restricciones',
        entidadId: habitacion.id,
        despues: { desde: dto.desde, hasta: dto.hasta, ...(dto.diasSemana && { diasSemana: dto.diasSemana }), noches: fechas.length, cambios },
      });
    });
    return this.listar(habitacion.id, dto.desde, dto.hasta, usuario);
  }
}
