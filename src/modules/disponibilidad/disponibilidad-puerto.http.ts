import { Body, Controller, Get, Global, HttpCode, HttpStatus, Injectable, Module, Post, UseFilters } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { HabitacionCatalogo, RefHabitacionStock } from '../catalogo/catalogo.puerto';
import { FuenteDisponibilidad, HabitacionParaPlanes, PedidoOfertas } from '../catalogo/fuente-disponibilidad';
import { llamarPuertoHttp, PuertoInternoFilter } from '../comun/puerto-http';
import { DesglosePrecio } from '../comun/v2/precios';
import { PedidoCupos, ResultadoConfirmacion, ResultadoLiberacion, ResultadoReserva } from './cupos.service';
import {
  CotizarV2Dto,
  CriterioDisponibilidad,
  DatosCotizacion,
  DesgloseV2,
  DisponibilidadPuerto,
  HabitacionDisponible,
  MotivoStock,
  Ocupacion,
  OpcionesDisponibilidadV2Query,
  PlanV2,
  RestriccionNoche,
} from './disponibilidad.puerto';
import { calcularOcupantes, construirDesgloseV2, validarCapacidadHabitacion } from './v2/disponibilidad-v2.service';

type CapacidadHabitacion = Pick<HabitacionCatalogo, 'codigo' | 'capacidadAdultos' | 'capacidadNinos'>;
type HabitacionParaPlanesV2 = Pick<HabitacionCatalogo, 'id' | 'capacidadAdultos' | 'mealPlan' | 'cancellationType'>;

@Controller('interno/disponibilidad')
@UseFilters(PuertoInternoFilter)
export class DisponibilidadPuertoController {
  constructor(private readonly disponibilidad: DisponibilidadPuerto) {}

  @Post('cupos/reservar')
  @HttpCode(HttpStatus.OK)
  reservarCupos(@Body() cuerpo: { pedido: PedidoCupos }): Promise<ResultadoReserva> {
    return this.disponibilidad.reservarCupos(cuerpo.pedido);
  }

  @Post('cupos/confirmar')
  @HttpCode(HttpStatus.OK)
  confirmarRetencion(
    @Body() cuerpo: { ordenId: string; habitacion: RefHabitacionStock | null; fechas: string[]; correlacionId?: string | null },
  ): Promise<ResultadoConfirmacion> {
    return this.disponibilidad.confirmarRetencion(cuerpo.ordenId, cuerpo.habitacion, cuerpo.fechas, cuerpo.correlacionId ?? null);
  }

  @Post('cupos/liberar')
  @HttpCode(HttpStatus.OK)
  liberarCupos(@Body() cuerpo: { ordenId: string }): Promise<ResultadoLiberacion> {
    return this.disponibilidad.liberarCupos(cuerpo.ordenId);
  }

  @Post('stock/avisar')
  @HttpCode(HttpStatus.OK)
  avisarStock(
    @Body() cuerpo: { habitacion: RefHabitacionStock | null; fechas: string[]; motivo: MotivoStock; ordenId?: string | null; correlacionId?: string | null },
  ): Promise<void> {
    return this.disponibilidad.avisarStock(cuerpo.habitacion, cuerpo.fechas, cuerpo.motivo, cuerpo.ordenId ?? null, cuerpo.correlacionId ?? null);
  }

  @Post('stock/avisar-futuro')
  @HttpCode(HttpStatus.OK)
  avisarStockFuturo(@Body() cuerpo: { habitacion: RefHabitacionStock | null; motivo?: MotivoStock }): Promise<void> {
    return this.disponibilidad.avisarStockFuturo(cuerpo.habitacion, cuerpo.motivo ?? 'ESTADO');
  }

  @Post('v1/habitaciones-disponibles')
  @HttpCode(HttpStatus.OK)
  habitacionesDisponibles(@Body() cuerpo: { criterio: CriterioDisponibilidad }): Promise<HabitacionDisponible[]> {
    return this.disponibilidad.habitacionesDisponibles(cuerpo.criterio);
  }

  @Post('ofertas')
  @HttpCode(HttpStatus.OK)
  async ofertas(@Body() cuerpo: { pedido: PedidoOfertas }): Promise<Record<string, number>> {
    return Object.fromEntries(await this.disponibilidad.ofertas(cuerpo.pedido));
  }

  @Post('proxima-noche')
  @HttpCode(HttpStatus.OK)
  async proximaNoche(@Body() cuerpo: { habitacionIds: string[]; desde: string }): Promise<Record<string, { cuposTotales: number; cupos: number }>> {
    return Object.fromEntries(await this.disponibilidad.proximaNoche(cuerpo.habitacionIds, cuerpo.desde));
  }

  @Post('planes-v2')
  @HttpCode(HttpStatus.OK)
  async planesV2(@Body() cuerpo: { habitaciones: HabitacionParaPlanes[] }): Promise<Record<string, unknown[]>> {
    return Object.fromEntries(await this.disponibilidad.planesV2(cuerpo.habitaciones));
  }

  @Post('ocupacion')
  @HttpCode(HttpStatus.OK)
  ocupacion(@Body() cuerpo: { habitacionIds: string[]; fecha: string }): Promise<{ totales: number; ocupadas: number }> {
    return this.disponibilidad.ocupacion(cuerpo.habitacionIds, cuerpo.fecha);
  }

  @Post('v2/cotizar')
  @HttpCode(HttpStatus.OK)
  cotizar(@Body() cuerpo: { dto: CotizarV2Dto }) {
    return this.disponibilidad.cotizar(cuerpo.dto);
  }

  @Post('v2/opciones')
  @HttpCode(HttpStatus.OK)
  opciones(@Body() cuerpo: { codigo: string; q: OpcionesDisponibilidadV2Query }) {
    return this.disponibilidad.opciones(cuerpo.codigo, cuerpo.q);
  }

  @Post('v2/planes')
  @HttpCode(HttpStatus.OK)
  async planes(@Body() cuerpo: { habitaciones: HabitacionParaPlanesV2[] }): Promise<Record<string, PlanV2[]>> {
    return Object.fromEntries(await this.disponibilidad.planes(cuerpo.habitaciones));
  }

  @Post('v2/restricciones')
  @HttpCode(HttpStatus.OK)
  async restricciones(@Body() cuerpo: { habitacionIds: string[]; fechas: string[] }): Promise<Record<string, Record<string, RestriccionNoche>>> {
    const mapa = await this.disponibilidad.restricciones(cuerpo.habitacionIds, cuerpo.fechas);
    return Object.fromEntries([...mapa.entries()].map(([habId, porFecha]) => [habId, Object.fromEntries(porFecha)]));
  }

  @Post('v2/cotizacion-por-id')
  @HttpCode(HttpStatus.OK)
  cotizacionPorId(@Body() cuerpo: { id: string }): Promise<DatosCotizacion | null> {
    return this.disponibilidad.cotizacionPorId(cuerpo.id);
  }

  @Post('v2/marcar-cotizacion-usada')
  @HttpCode(HttpStatus.OK)
  marcarCotizacionUsada(@Body() cuerpo: { id: string }): Promise<void> {
    return this.disponibilidad.marcarCotizacionUsada(cuerpo.id);
  }

  @Post('v2/alojamiento-activo')
  @HttpCode(HttpStatus.OK)
  alojamientoActivo(@Body() cuerpo: { codigo: string }): Promise<{ id: number; codigo: string }> {
    return this.disponibilidad.alojamientoActivo(cuerpo.codigo);
  }

  @Post('mantenimiento/limpiar')
  @HttpCode(HttpStatus.OK)
  limpiar(): Promise<{ outboxStock: number; cotizaciones: number }> {
    return this.disponibilidad.limpiar();
  }

  @Get('mantenimiento/estado-outbox')
  estadoOutbox() {
    return this.disponibilidad.estadoOutbox();
  }

  @Get('mantenimiento/estado-envio')
  estadoEnvio() {
    return this.disponibilidad.estadoEnvio();
  }
}

// Implementación HTTP de DisponibilidadPuerto para procesos fuera de disponibilidad (D1 de fase 9.2).
@Injectable()
export class DisponibilidadPuertoHttp implements FuenteDisponibilidad {
  private get baseUrl(): string {
    return process.env.DISPONIBILIDAD_URL?.trim() || 'http://localhost:3003';
  }

  reservarCupos(pedido: PedidoCupos): Promise<ResultadoReserva> {
    return llamarPuertoHttp<ResultadoReserva>(this.baseUrl, '/api/v1/interno/disponibilidad/cupos/reservar', {
      cuerpo: { pedido },
    });
  }

  async confirmarRetencion(ordenId: string, habitacion: RefHabitacionStock | null, fechas: string[], correlacionId: string | null = null): Promise<ResultadoConfirmacion> {
    const res = await llamarPuertoHttp<ResultadoConfirmacion | { resultado: ResultadoConfirmacion }>(this.baseUrl, '/api/v1/interno/disponibilidad/cupos/confirmar', {
      cuerpo: { ordenId, habitacion, fechas, correlacionId },
    });
    if (typeof res === 'object' && res !== null && 'resultado' in res) {
      return (res as { resultado: ResultadoConfirmacion }).resultado;
    }
    return res as ResultadoConfirmacion;
  }

  liberarCupos(ordenId: string): Promise<ResultadoLiberacion> {
    return llamarPuertoHttp<ResultadoLiberacion>(this.baseUrl, '/api/v1/interno/disponibilidad/cupos/liberar', {
      cuerpo: { ordenId },
    });
  }

  avisarStock(habitacion: RefHabitacionStock | null, fechas: string[], motivo: MotivoStock, ordenId: string | null = null, correlacionId: string | null = null): Promise<void> {
    return llamarPuertoHttp<void>(this.baseUrl, '/api/v1/interno/disponibilidad/stock/avisar', {
      cuerpo: { habitacion, fechas, motivo, ordenId, correlacionId },
    });
  }

  avisarStockFuturo(habitacion: RefHabitacionStock | null, motivo: MotivoStock = 'ESTADO'): Promise<void> {
    return llamarPuertoHttp<void>(this.baseUrl, '/api/v1/interno/disponibilidad/stock/avisar-futuro', {
      cuerpo: { habitacion, motivo },
    });
  }

  habitacionesDisponibles(criterio: CriterioDisponibilidad): Promise<HabitacionDisponible[]> {
    return llamarPuertoHttp<HabitacionDisponible[]>(this.baseUrl, '/api/v1/interno/disponibilidad/v1/habitaciones-disponibles', {
      cuerpo: { criterio },
    });
  }

  async ofertas(pedido: PedidoOfertas): Promise<Map<string, number>> {
    const mapa = await llamarPuertoHttp<Record<string, number>>(this.baseUrl, '/api/v1/interno/disponibilidad/ofertas', {
      cuerpo: { pedido },
    });
    return new Map(Object.entries(mapa ?? {}).map(([k, v]) => [k, Number(v)]));
  }

  async proximaNoche(habitacionIds: string[], desde: string): Promise<Map<string, { cuposTotales: number; cupos: number }>> {
    if (habitacionIds.length === 0) return new Map();
    const mapa = await llamarPuertoHttp<Record<string, { cuposTotales: number; cupos: number }>>(this.baseUrl, '/api/v1/interno/disponibilidad/proxima-noche', {
      cuerpo: { habitacionIds, desde },
    });
    return new Map(Object.entries(mapa ?? {}));
  }

  async planesV2(habitaciones: HabitacionParaPlanes[]): Promise<Map<string, unknown[]>> {
    const mapa = await llamarPuertoHttp<Record<string, unknown[]>>(this.baseUrl, '/api/v1/interno/disponibilidad/planes-v2', {
      cuerpo: { habitaciones },
    });
    return new Map(Object.entries(mapa ?? {}));
  }

  ocupacion(habitacionIds: string[], fecha: string): Promise<{ totales: number; ocupadas: number }> {
    if (habitacionIds.length === 0) return Promise.resolve({ totales: 0, ocupadas: 0 });
    return llamarPuertoHttp<{ totales: number; ocupadas: number }>(this.baseUrl, '/api/v1/interno/disponibilidad/ocupacion', {
      cuerpo: { habitacionIds, fecha },
    });
  }

  cotizar(dto: CotizarV2Dto) {
    return llamarPuertoHttp<ReturnType<DisponibilidadPuerto['cotizar']> extends Promise<infer R> ? R : never>(
      this.baseUrl,
      '/api/v1/interno/disponibilidad/v2/cotizar',
      { cuerpo: { dto } },
    );
  }

  opciones(codigo: string, q: OpcionesDisponibilidadV2Query) {
    return llamarPuertoHttp<ReturnType<DisponibilidadPuerto['opciones']> extends Promise<infer R> ? R : never>(
      this.baseUrl,
      '/api/v1/interno/disponibilidad/v2/opciones',
      { cuerpo: { codigo, q } },
    );
  }

  async planes(habitaciones: HabitacionParaPlanesV2[]): Promise<Map<string, PlanV2[]>> {
    const mapa = await llamarPuertoHttp<Record<string, PlanV2[]>>(this.baseUrl, '/api/v1/interno/disponibilidad/v2/planes', {
      cuerpo: { habitaciones },
    });
    return new Map(Object.entries(mapa ?? {}));
  }

  async restricciones(habitacionIds: string[], fechas: string[]): Promise<Map<string, Map<string, RestriccionNoche>>> {
    if (habitacionIds.length === 0) return new Map();
    const mapa = await llamarPuertoHttp<Record<string, Record<string, RestriccionNoche>>>(this.baseUrl, '/api/v1/interno/disponibilidad/v2/restricciones', {
      cuerpo: { habitacionIds, fechas },
    });
    return new Map(Object.entries(mapa ?? {}).map(([habId, porFecha]) => [habId, new Map(Object.entries(porFecha ?? {}))]));
  }

  async cotizacionPorId(id: string, _manager?: EntityManager): Promise<DatosCotizacion | null> {
    const cotizacion = await llamarPuertoHttp<(Omit<DatosCotizacion, 'validaHasta'> & { validaHasta: string | Date }) | null>(
      this.baseUrl,
      '/api/v1/interno/disponibilidad/v2/cotizacion-por-id',
      { cuerpo: { id } },
    );
    return cotizacion ? { ...cotizacion, validaHasta: new Date(cotizacion.validaHasta) } : null;
  }

  marcarCotizacionUsada(id: string): Promise<void> {
    return llamarPuertoHttp<void>(this.baseUrl, '/api/v1/interno/disponibilidad/v2/marcar-cotizacion-usada', {
      cuerpo: { id },
    });
  }

  ocupantes(o: { adultos: number; ninos?: number; edadesNinos?: number[] }, campo: string): Ocupacion {
    return calcularOcupantes(o, campo);
  }

  exigirCapacidad(habitacion: CapacidadHabitacion, o: Ocupacion, habitaciones: number): void {
    validarCapacidadHabitacion(habitacion, o, habitaciones);
  }

  alojamientoActivo(codigo: string): Promise<{ id: number; codigo: string }> {
    return llamarPuertoHttp<{ id: number; codigo: string }>(this.baseUrl, '/api/v1/interno/disponibilidad/v2/alojamiento-activo', {
      cuerpo: { codigo },
    });
  }

  aDesgloseV2(d: DesglosePrecio): DesgloseV2 {
    return construirDesgloseV2(d);
  }

  limpiar(): Promise<{ outboxStock: number; cotizaciones: number }> {
    return llamarPuertoHttp<{ outboxStock: number; cotizaciones: number }>(this.baseUrl, '/api/v1/interno/disponibilidad/mantenimiento/limpiar');
  }

  estadoOutbox() {
    return llamarPuertoHttp<ReturnType<DisponibilidadPuerto['estadoOutbox']> extends Promise<infer R> ? R : never>(
      this.baseUrl,
      '/api/v1/interno/disponibilidad/mantenimiento/estado-outbox',
      { metodo: 'GET' },
    );
  }

  estadoEnvio() {
    return llamarPuertoHttp<ReturnType<DisponibilidadPuerto['estadoEnvio']>>(
      this.baseUrl,
      '/api/v1/interno/disponibilidad/mantenimiento/estado-envio',
      { metodo: 'GET' },
    );
  }
}

@Global()
@Module({
  providers: [DisponibilidadPuertoHttp, { provide: DisponibilidadPuerto, useExisting: DisponibilidadPuertoHttp }],
  exports: [DisponibilidadPuerto],
})
export class DisponibilidadPuertosHttpModule {}

