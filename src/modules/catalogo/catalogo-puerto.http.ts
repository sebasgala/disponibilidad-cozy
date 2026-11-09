import { Body, Controller, Get, Global, HttpCode, HttpStatus, Injectable, Module, Post, UseFilters } from '@nestjs/common';
import { llamarPuertoHttp, PuertoInternoFilter } from '../comun/puerto-http';
import { UsuarioSesion } from '../usuarios/usuarios.contrato';
import { AlojamientoCatalogo, CatalogoPuerto, FiltroHabitaciones, HabitacionCatalogo } from './catalogo.puerto';

@Controller('interno/catalogo')
@UseFilters(PuertoInternoFilter)
export class CatalogoPuertoController {
  constructor(private readonly catalogo: CatalogoPuerto) {}

  @Post('alojamientos/por-codigo')
  @HttpCode(HttpStatus.OK)
  alojamientoPorCodigo(@Body() cuerpo: { codigo: string; opciones?: { soloActivo?: boolean } }): Promise<AlojamientoCatalogo | null> {
    return this.catalogo.alojamientoPorCodigo(cuerpo.codigo, cuerpo.opciones);
  }

  @Post('alojamientos/por-id')
  @HttpCode(HttpStatus.OK)
  alojamientoPorId(@Body() cuerpo: { id: number }): Promise<AlojamientoCatalogo | null> {
    return this.catalogo.alojamientoPorId(cuerpo.id);
  }

  @Post('alojamientos/activo-por-id')
  @HttpCode(HttpStatus.OK)
  alojamientoActivoPorId(@Body() cuerpo: { id: number }): Promise<AlojamientoCatalogo | null> {
    return this.catalogo.alojamientoActivoPorId(cuerpo.id);
  }

  @Post('alojamientos/por-ids')
  @HttpCode(HttpStatus.OK)
  async alojamientosPorIds(@Body() cuerpo: { ids: number[] }): Promise<Record<string, AlojamientoCatalogo>> {
    return Object.fromEntries(await this.catalogo.alojamientosPorIds(cuerpo.ids));
  }

  @Post('alojamientos/ids-de-propietario')
  @HttpCode(HttpStatus.OK)
  idsDeAlojamientosDe(@Body() cuerpo: { propietarioId: string }): Promise<number[]> {
    return this.catalogo.idsDeAlojamientosDe(cuerpo.propietarioId);
  }

  @Get('a-la-venta')
  aLaVenta(): Promise<{ propiedades: number; habitacionIds: string[] }> {
    return this.catalogo.aLaVenta();
  }

  @Post('habitaciones/filtrar')
  @HttpCode(HttpStatus.OK)
  habitaciones(@Body() cuerpo: { filtro: FiltroHabitaciones }): Promise<HabitacionCatalogo[]> {
    return this.catalogo.habitaciones(cuerpo.filtro);
  }

  @Post('habitaciones/por-ids')
  @HttpCode(HttpStatus.OK)
  async habitacionesPorIds(@Body() cuerpo: { ids: string[] }): Promise<Record<string, HabitacionCatalogo>> {
    return Object.fromEntries(await this.catalogo.habitacionesPorIds(cuerpo.ids));
  }

  @Post('habitaciones/activa')
  @HttpCode(HttpStatus.OK)
  habitacionActiva(@Body() cuerpo: { alojamientoId: number; codigo: string }): Promise<HabitacionCatalogo | null> {
    return this.catalogo.habitacionActiva(cuerpo.alojamientoId, cuerpo.codigo);
  }

  @Post('habitaciones/administrable')
  @HttpCode(HttpStatus.OK)
  habitacionAdministrable(@Body() cuerpo: { id: string; usuario: UsuarioSesion }): Promise<HabitacionCatalogo> {
    return this.catalogo.habitacionAdministrable(cuerpo.id, cuerpo.usuario);
  }
}

// Implementación HTTP de CatalogoPuerto para procesos fuera de catálogo (D1 de fase 9.2).
@Injectable()
export class CatalogoPuertoHttp {
  private get baseUrl(): string {
    return process.env.CATALOGO_URL?.trim() || 'http://localhost:3002';
  }

  alojamientoPorCodigo(codigo: string, opciones: { soloActivo?: boolean } = {}): Promise<AlojamientoCatalogo | null> {
    return llamarPuertoHttp<AlojamientoCatalogo | null>(this.baseUrl, '/api/v1/interno/catalogo/alojamientos/por-codigo', {
      cuerpo: { codigo, opciones },
    });
  }

  alojamientoPorId(id: number): Promise<AlojamientoCatalogo | null> {
    return llamarPuertoHttp<AlojamientoCatalogo | null>(this.baseUrl, '/api/v1/interno/catalogo/alojamientos/por-id', {
      cuerpo: { id },
    });
  }

  alojamientoActivoPorId(id: number): Promise<AlojamientoCatalogo | null> {
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) return Promise.resolve(null);
    return llamarPuertoHttp<AlojamientoCatalogo | null>(this.baseUrl, '/api/v1/interno/catalogo/alojamientos/activo-por-id', {
      cuerpo: { id },
    });
  }

  async alojamientosPorIds(ids: number[]): Promise<Map<number, AlojamientoCatalogo>> {
    if (ids.length === 0) return new Map();
    const mapa = await llamarPuertoHttp<Record<string, AlojamientoCatalogo>>(this.baseUrl, '/api/v1/interno/catalogo/alojamientos/por-ids', {
      cuerpo: { ids },
    });
    return new Map(Object.entries(mapa ?? {}).map(([k, v]) => [Number(k), v]));
  }

  idsDeAlojamientosDe(propietarioId: string): Promise<number[]> {
    return llamarPuertoHttp<number[]>(this.baseUrl, '/api/v1/interno/catalogo/alojamientos/ids-de-propietario', {
      cuerpo: { propietarioId },
    });
  }

  aLaVenta(): Promise<{ propiedades: number; habitacionIds: string[] }> {
    return llamarPuertoHttp<{ propiedades: number; habitacionIds: string[] }>(this.baseUrl, '/api/v1/interno/catalogo/a-la-venta', {
      metodo: 'GET',
    });
  }

  habitaciones(filtro: FiltroHabitaciones): Promise<HabitacionCatalogo[]> {
    if (filtro.ids && filtro.ids.length === 0) return Promise.resolve([]);
    return llamarPuertoHttp<HabitacionCatalogo[]>(this.baseUrl, '/api/v1/interno/catalogo/habitaciones/filtrar', {
      cuerpo: { filtro },
    });
  }

  async habitacionesPorIds(ids: string[]): Promise<Map<string, HabitacionCatalogo>> {
    if (ids.length === 0) return new Map();
    const mapa = await llamarPuertoHttp<Record<string, HabitacionCatalogo>>(this.baseUrl, '/api/v1/interno/catalogo/habitaciones/por-ids', {
      cuerpo: { ids },
    });
    return new Map(Object.entries(mapa ?? {}));
  }

  habitacionActiva(alojamientoId: number, codigo: string): Promise<HabitacionCatalogo | null> {
    return llamarPuertoHttp<HabitacionCatalogo | null>(this.baseUrl, '/api/v1/interno/catalogo/habitaciones/activa', {
      cuerpo: { alojamientoId, codigo },
    });
  }

  habitacionAdministrable(id: string, usuario: UsuarioSesion): Promise<HabitacionCatalogo> {
    return llamarPuertoHttp<HabitacionCatalogo>(this.baseUrl, '/api/v1/interno/catalogo/habitaciones/administrable', {
      cuerpo: { id, usuario },
    });
  }
}

@Global()
@Module({
  providers: [CatalogoPuertoHttp, { provide: CatalogoPuerto, useExisting: CatalogoPuertoHttp }],
  exports: [CatalogoPuerto],
})
export class CatalogoPuertosHttpModule {}

