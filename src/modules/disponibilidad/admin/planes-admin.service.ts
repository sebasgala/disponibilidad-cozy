import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ActualizarPlanTarifaDto, CrearPlanTarifaDto, PlanTarifaAdminResponseDto } from '../dto/admin/planes-restricciones-admin.dto';
import { PlanTarifa } from '../entities/plan-tarifa.entity';
import { UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { esUuid } from '../../comun/alojamientos-consulta.utils';
import { ConsultaInvalidaException, RecursoNoEncontradoException } from '../../comun/problems/problem-details.exceptions';
import { AuditoriaService } from '../../comun/auditoria.service';
import { CatalogoPuerto } from '../../catalogo/catalogo.puerto';
import { CONEXION } from '../../../database/conexiones';

// En PATCH estos campos no pueden venir en null (las columnas son NOT NULL)
const CAMPOS_NO_NULOS: (keyof ActualizarPlanTarifaDto)[] = [
  'nombre',
  'regimen',
  'modeloPago',
  'esReembolsable',
  'ajustePorcentaje',
  'ocupacionBase',
  'suplementoAdultoExtra',
  'edadMaximaGratisNinos',
  'suplementoNino',
  'activo',
];

const CAMPOS_AUDITADOS = [
  'codigo',
  'nombre',
  'regimen',
  'modeloPago',
  'esReembolsable',
  'horasLimiteCancelacion',
  'penalidadPorcentaje',
  'ajustePorcentaje',
  'ocupacionBase',
  'suplementoAdultoExtra',
  'edadMaximaGratisNinos',
  'suplementoNino',
  'activo',
] as const;
const foto = (p: PlanTarifa) => Object.fromEntries(CAMPOS_AUDITADOS.map((campo) => [campo, p[campo]]));

// Planes de tarifa ADICIONALES de una habitación (/admin/habitaciones/{id}/planes y /admin/planes/{planId}).
// El plan por defecto ESTANDAR no se administra aquí: sale de la propia habitación. Nunca se borran filas:
// activo = false saca el plan de la venta. Cada cambio escribe su fila de auditoría en la misma transacción.
@Injectable()
export class PlanesAdminService {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly catalogo: CatalogoPuerto,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(habitacionId: string, usuario: Usuario): Promise<PlanTarifaAdminResponseDto[]> {
    const habitacion = await this.catalogo.habitacionAdministrable(habitacionId, usuario);
    const planes = await this.dataSource.getRepository(PlanTarifa).find({ where: { habitacionId: habitacion.id }, order: { codigo: 'ASC' } });
    return planes.map((p) => this.aRespuesta(p));
  }

  async crear(habitacionId: string, dto: CrearPlanTarifaDto, usuario: Usuario): Promise<PlanTarifaAdminResponseDto> {
    const habitacion = await this.catalogo.habitacionAdministrable(habitacionId, usuario);
    this.exigirPoliticaCoherente(dto.esReembolsable, dto.horasLimiteCancelacion, dto.penalidadPorcentaje);
    const nuevo = await this.dataSource.transaction(async (manager) => {
      const guardado = await manager.save(
        manager.create(PlanTarifa, {
          habitacionId: habitacion.id,
          codigo: dto.codigo,
          nombre: dto.nombre,
          regimen: dto.regimen,
          modeloPago: dto.modeloPago ?? 'PREPAGO',
          esReembolsable: dto.esReembolsable,
          horasLimiteCancelacion: dto.horasLimiteCancelacion ?? null,
          penalidadPorcentaje: dto.penalidadPorcentaje ?? null,
          ajustePorcentaje: dto.ajustePorcentaje ?? 0,
          ocupacionBase: dto.ocupacionBase ?? 2,
          suplementoAdultoExtra: dto.suplementoAdultoExtra ?? 0,
          edadMaximaGratisNinos: dto.edadMaximaGratisNinos ?? 17,
          suplementoNino: dto.suplementoNino ?? 0,
          activo: true,
        }),
      );
      await this.auditoria.registrar(manager, {
        modulo: 'disponibilidad',
        usuarioId: usuario.id,
        accion: 'crear',
        entidad: 'plan_tarifa',
        entidadId: guardado.id,
        despues: { habitacionId: habitacion.id, ...foto(guardado) },
      });
      return guardado;
    });
    return this.aRespuesta(nuevo);
  }

  async actualizar(planId: string, dto: ActualizarPlanTarifaDto, usuario: Usuario): Promise<PlanTarifaAdminResponseDto> {
    const plan = esUuid(planId) ? await this.dataSource.getRepository(PlanTarifa).findOneBy({ id: planId }) : null;
    if (!plan) throw this.noEncontrado(planId);
    // El permiso se decide por la habitación (y su alojamiento): un plan ajeno es, para el que pide, un plan inexistente
    await this.catalogo.habitacionAdministrable(plan.habitacionId, usuario).catch(() => {
      throw this.noEncontrado(planId);
    });
    const nulos = CAMPOS_NO_NULOS.filter((campo) => dto[campo] === null);
    if (nulos.length > 0) throw new ConsultaInvalidaException(nulos.map((campo) => ({ name: campo, reason: 'no puede ser null' })));

    const antes = foto(plan);
    Object.assign(plan, Object.fromEntries(Object.entries(dto).filter(([, valor]) => valor !== undefined)));
    this.exigirPoliticaCoherente(plan.esReembolsable, plan.horasLimiteCancelacion, plan.penalidadPorcentaje);
    const guardado = await this.dataSource.transaction(async (manager) => {
      const g = await manager.save(plan);
      await this.auditoria.registrar(manager, { modulo: 'disponibilidad', usuarioId: usuario.id, accion: 'actualizar', entidad: 'plan_tarifa', entidadId: g.id, antes, despues: foto(g) });
      return g;
    });
    return this.aRespuesta(guardado);
  }

  private noEncontrado(planId: string): RecursoNoEncontradoException {
    const detalle = `El plan de tarifa ${planId} no existe`;
    return new RecursoNoEncontradoException(detalle, [{ name: 'planId', reason: detalle }]);
  }

  // Un plan no reembolsable no tiene ventana de cancelación ni penalidad
  private exigirPoliticaCoherente(esReembolsable: boolean, horas?: number | null, penalidad?: number | null): void {
    if (!esReembolsable && (horas !== undefined && horas !== null || penalidad !== undefined && penalidad !== null)) {
      throw new ConsultaInvalidaException([{ name: 'esReembolsable', reason: 'un plan no reembolsable no lleva horasLimiteCancelacion ni penalidadPorcentaje' }]);
    }
  }

  private aRespuesta(p: PlanTarifa): PlanTarifaAdminResponseDto {
    return {
      id: p.id,
      habitacionId: p.habitacionId,
      codigo: p.codigo,
      nombre: p.nombre,
      regimen: p.regimen,
      modeloPago: p.modeloPago,
      esReembolsable: p.esReembolsable,
      horasLimiteCancelacion: p.horasLimiteCancelacion,
      penalidadPorcentaje: p.penalidadPorcentaje,
      ajustePorcentaje: Number(p.ajustePorcentaje),
      ocupacionBase: p.ocupacionBase,
      suplementoAdultoExtra: Number(p.suplementoAdultoExtra),
      edadMaximaGratisNinos: p.edadMaximaGratisNinos,
      suplementoNino: Number(p.suplementoNino),
      activo: p.activo,
      _links: { self: `/api/v1/admin/planes/${p.id}`, habitacion: `/api/v1/admin/habitaciones/${p.habitacionId}` },
    };
  }
}
