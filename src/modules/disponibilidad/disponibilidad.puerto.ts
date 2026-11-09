import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { HabitacionCatalogo, RefHabitacionStock } from '../catalogo/catalogo.puerto';
import { FuenteDisponibilidad, HabitacionParaPlanes, PedidoOfertas } from '../catalogo/fuente-disponibilidad';
import { aCentavos } from '../comun/v2/dinero';
import { DesglosePrecio } from '../comun/v2/precios';
import { CuposService, MINUTOS_RETENCION_PROVISIONAL, PedidoCupos, ResultadoConfirmacion, ResultadoLiberacion, ResultadoReserva } from './cupos.service';
import { CriterioDisponibilidad, DisponibilidadService, HabitacionDisponible } from './disponibilidad.service';
import { PlanTarifa } from './entities/plan-tarifa.entity';
import { DatosCotizacion, DisponibilidadV2Service, Ocupacion } from './v2/disponibilidad-v2.service';
import { CotizarV2Dto, OpcionesDisponibilidadV2Query } from './v2/dto/disponibilidad-v2.dto';
import { LimpiezaDisponibilidadService } from './v2/limpieza-disponibilidad.service';
import { aRatePlanV2, PlanV2, planesDeHabitacion } from './v2/planes';
import { RestriccionNoche } from './v2/restricciones';
import { StockEnvioWorker } from './v2/stock-envio.worker';
import { MotivoStock, StockOutboxService } from './v2/stock-outbox.service';
import { CONEXION } from '../../database/conexiones';

// Lo que los otros módulos pueden usar de disponibilidad sin ser servicios: tipos, DTO de entrada y funciones puras.
// Se reexportan aquí para que reservas y consultas importen de disponibilidad solo este archivo (fase 8.3c).
export type { CriterioDisponibilidad, DatosCotizacion, HabitacionDisponible, MotivoStock, Ocupacion, PedidoCupos, PlanV2, ResultadoConfirmacion, ResultadoLiberacion, ResultadoReserva, RestriccionNoche };
export type { PoliticaCancelacion } from './v2/planes';
export { PLAN_ESTANDAR } from './v2/planes';
export { evaluarRestricciones } from './v2/restricciones';
export { nochesDe } from './v2/stock-outbox.service';
export { CotizarV2Dto, ID_ALOJAMIENTO, OcupantesV2Dto, OpcionesDisponibilidadV2Query } from './v2/dto/disponibilidad-v2.dto';
// DesglosePrecioV2 del contrato, tal como lo arma aDesgloseV2
export type DesgloseV2 = ReturnType<DisponibilidadV2Service['aDesgloseV2']>;

type CapacidadHabitacion = Pick<HabitacionCatalogo, 'codigo' | 'capacidadAdultos' | 'capacidadNinos'>;
type HabitacionParaPlanesV2 = Pick<HabitacionCatalogo, 'id' | 'capacidadAdultos' | 'mealPlan' | 'cancellationType'>;

// Puerto de disponibilidad (fase 8.0; fachada única desde 8.3c): lo único de este módulo que usan reservas y consultas.
// Implementa además la FuenteDisponibilidad que usa el catálogo para buscar por fechas.
//
// Las lecturas propias (ofertas, proximaNoche, planesV2, ocupacion) viven aquí. El resto delega en los servicios del
// módulo SIN cambiar la lógica: misma firma y mismo comportamiento que el servicio de origen (indicado en cada método).
// Contrato: contracts/disponibilidad-puerto-openapi.yaml (lo comprueba scripts/verificar-contrato-disponibilidad.mjs).
//
// Saga de 8.4 (E2): reservarCupos, liberarCupos, confirmarRetencion, avisarStock y avisarStockFuturo abren y confirman
// su propia transacción de disponibilidad; nunca la de quien llama. Desde 9.0 también marcarCotizacionUsada. Solo
// cotizacionPorId acepta todavía el manager de quien llama (opcional; reservas ya no se lo pasa).
@Injectable()
export class DisponibilidadPuerto implements FuenteDisponibilidad {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly cupos: CuposService,
    private readonly stock: StockOutboxService,
    private readonly inventario: DisponibilidadService,
    private readonly v2: DisponibilidadV2Service,
    private readonly limpieza: LimpiezaDisponibilidadService,
    private readonly envio: StockEnvioWorker,
  ) {}

  // ───────────── Cupos (CuposService): Reservar / Confirmar / Liberar, idempotentes por orden ─────────────

  // CuposService.reservar: la retención nace provisional y vence a los 15 minutos si nadie la confirma. No avisa stock.
  reservarCupos(pedido: PedidoCupos): Promise<ResultadoReserva> {
    const venceEn = new Date(Date.now() + MINUTOS_RETENCION_PROVISIONAL * 60_000);
    return this.dataSource.transaction((manager) => this.cupos.reservar(manager, pedido, venceEn));
  }

  // CuposService.confirmar y, si la retención pasa a confirmada, el aviso de stock de la reserva a Booking en la misma
  // transacción (el mismo aviso que antes salía al crear la orden). Repetirla no avisa dos veces.
  confirmarRetencion(ordenId: string, habitacion: RefHabitacionStock | null, fechas: string[], correlacionId: string | null = null): Promise<ResultadoConfirmacion> {
    return this.dataSource.transaction(async (manager) => {
      const { resultado } = await this.cupos.confirmar(manager, ordenId);
      if (resultado === 'CONFIRMADA') await this.stock.encolar(manager, habitacion, fechas, 'RESERVA', ordenId, correlacionId);
      return resultado;
    });
  }

  // CuposService.liberar
  liberarCupos(ordenId: string): Promise<ResultadoLiberacion> {
    return this.dataSource.transaction((manager) => this.cupos.liberar(manager, ordenId));
  }

  // ───────────── Avisos de stock hacia Booking (StockOutboxService) ─────────────

  // StockOutboxService.encolar
  avisarStock(habitacion: RefHabitacionStock | null, fechas: string[], motivo: MotivoStock, ordenId: string | null = null, correlacionId: string | null = null): Promise<void> {
    return this.dataSource.transaction((manager) => this.stock.encolar(manager, habitacion, fechas, motivo, ordenId, correlacionId));
  }

  // StockOutboxService.encolarFuturas
  avisarStockFuturo(habitacion: RefHabitacionStock | null, motivo: MotivoStock = 'ESTADO'): Promise<void> {
    return this.dataSource.transaction((manager) => this.stock.encolarFuturas(manager, habitacion, motivo));
  }

  // ───────────── Disponibilidad v1 (DisponibilidadService) ─────────────

  // DisponibilidadService.habitacionesDisponibles
  habitacionesDisponibles(criterio: CriterioDisponibilidad): Promise<HabitacionDisponible[]> {
    return this.inventario.habitacionesDisponibles(criterio);
  }

  // ───────────── FuenteDisponibilidad del catálogo y ocupación (lecturas propias) ─────────────

  async ofertas(pedido: PedidoOfertas): Promise<Map<string, number>> {
    const filas: { habitacionId: string; total: string }[] = await this.dataSource.query(
      `SELECT "habitacionId", SUM("precio") AS "total" FROM "disponibilidad"."disponibilidad_diaria"
       WHERE "fecha" >= $1 AND "fecha" < $2 AND "cupos" >= $3
       GROUP BY "habitacionId" HAVING COUNT(*) = $4`,
      [pedido.checkin, pedido.checkout, pedido.cupos, pedido.noches],
    );
    return new Map(filas.map((f) => [f.habitacionId, Number(f.total)]));
  }

  async proximaNoche(habitacionIds: string[], desde: string): Promise<Map<string, { cuposTotales: number; cupos: number }>> {
    if (habitacionIds.length === 0) return new Map();
    const filas: { habitacionId: string; cuposTotales: number; cupos: number }[] = await this.dataSource.query(
      `SELECT DISTINCT ON ("habitacionId") "habitacionId", "cuposTotales", "cupos" FROM "disponibilidad"."disponibilidad_diaria"
       WHERE "habitacionId" = ANY($1::uuid[]) AND "fecha" >= $2 ORDER BY "habitacionId", "fecha"`,
      [habitacionIds, desde],
    );
    return new Map(filas.map((f) => [f.habitacionId, { cuposTotales: f.cuposTotales, cupos: f.cupos }]));
  }

  async planesV2(habitaciones: HabitacionParaPlanes[]): Promise<Map<string, unknown[]>> {
    const ids = habitaciones.map((h) => h.id);
    const adicionales = ids.length ? await this.dataSource.getRepository(PlanTarifa).find({ where: { habitacionId: In(ids), activo: true } }) : [];
    return new Map(
      habitaciones.map((h) => [h.id, planesDeHabitacion(h, adicionales.filter((p) => p.habitacionId === h.id)).map((plan) => aRatePlanV2(plan, aCentavos(Number(h.precioBase))))]),
    );
  }

  // Cupos totales y ocupados de una noche, solo de las habitaciones dadas (las que el catálogo tiene a la venta)
  async ocupacion(habitacionIds: string[], fecha: string): Promise<{ totales: number; ocupadas: number }> {
    if (habitacionIds.length === 0) return { totales: 0, ocupadas: 0 };
    const [fila] = await this.dataSource.query(
      `SELECT COALESCE(SUM("cuposTotales"), 0)::int AS totales, COALESCE(SUM("cuposTotales" - "cupos"), 0)::int AS ocupadas
       FROM "disponibilidad"."disponibilidad_diaria" WHERE "habitacionId" = ANY($1::uuid[]) AND "fecha" = $2`,
      [habitacionIds, fecha],
    );
    return fila;
  }

  // ───────────── Cotización, planes y restricciones v2 (DisponibilidadV2Service) ─────────────

  // DisponibilidadV2Service.cotizar (POST /alojamientos/availability)
  cotizar(dto: CotizarV2Dto) {
    return this.v2.cotizar(dto);
  }

  // DisponibilidadV2Service.opciones (GET /alojamientos/{id}/availability)
  opciones(codigo: string, q: OpcionesDisponibilidadV2Query) {
    return this.v2.opciones(codigo, q);
  }

  // DisponibilidadV2Service.planes
  planes(habitaciones: HabitacionParaPlanesV2[]): Promise<Map<string, PlanV2[]>> {
    return this.v2.planes(habitaciones);
  }

  // DisponibilidadV2Service.restricciones
  restricciones(habitacionIds: string[], fechas: string[]): Promise<Map<string, Map<string, RestriccionNoche>>> {
    return this.v2.restricciones(habitacionIds, fechas);
  }

  // DisponibilidadV2Service.cotizacionPorId; null si no existe
  cotizacionPorId(id: string, manager?: EntityManager): Promise<DatosCotizacion | null> {
    return this.v2.cotizacionPorId(id, manager);
  }

  // DisponibilidadV2Service.marcarCotizacionUsada
  marcarCotizacionUsada(id: string): Promise<void> {
    return this.v2.marcarCotizacionUsada(id);
  }

  // DisponibilidadV2Service.ocupacion. Se llama `ocupantes` aquí porque `ocupacion` ya es la ocupación de una noche.
  ocupantes(o: { adultos: number; ninos?: number; edadesNinos?: number[] }, campo: string): Ocupacion {
    return this.v2.ocupacion(o, campo);
  }

  // DisponibilidadV2Service.exigirCapacidad
  exigirCapacidad(habitacion: CapacidadHabitacion, o: Ocupacion, habitaciones: number): void {
    this.v2.exigirCapacidad(habitacion, o, habitaciones);
  }

  // DisponibilidadV2Service.alojamientoActivo; 404 si no existe o está de baja
  alojamientoActivo(codigo: string): Promise<{ id: number; codigo: string }> {
    return this.v2.alojamientoActivo(codigo);
  }

  // DisponibilidadV2Service.aDesgloseV2
  aDesgloseV2(d: DesglosePrecio): DesgloseV2 {
    return this.v2.aDesgloseV2(d);
  }

  // ───────────── Mantenimiento y estado para el panel ─────────────

  // LimpiezaDisponibilidadService.limpiar
  limpiar(): Promise<{ outboxStock: number; cotizaciones: number }> {
    return this.limpieza.limpiar();
  }

  // LimpiezaDisponibilidadService.estadoOutbox
  estadoOutbox() {
    return this.limpieza.estadoOutbox();
  }

  // StockEnvioWorker.estado
  estadoEnvio() {
    return this.envio.estado();
  }
}

export { DisponibilidadPuertoController, DisponibilidadPuertoHttp, DisponibilidadPuertosHttpModule } from './disponibilidad-puerto.http';
