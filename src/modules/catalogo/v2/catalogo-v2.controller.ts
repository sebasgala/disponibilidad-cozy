import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { hoyIso } from '../../comun/alojamientos-consulta.utils';
import { CatalogoV2Service } from './catalogo-v2.service';
import { BuscarAlojamientosV2Dto, ListarAlojamientosV2Query, PaginaV2Query } from './dto/catalogo-v2.dto';
import { EtagV2Interceptor } from '../../comun/v2/etag-v2.interceptor';
import { ProblemaV2Filter } from '../../comun/v2/problemas-v2';
import { idAlojamientoV2 } from '../../comun/v2/id-alojamiento-v2';
import { validacionConsultaV2, validacionCuerpoV2 } from '../../comun/v2/validacion-v2';
import { CotizarV2Dto, DisponibilidadPuerto, OpcionesDisponibilidadV2Query } from '../../disponibilidad/disponibilidad.puerto';
import { CatalogoPuerto } from '../catalogo.puerto';
import { PoliticaPaquetesService } from './politica-paquetes.service';

// Rutas estáticas de /alojamientos del contrato v2. Se registran ANTES que AlojamientoV2Controller (las de `{id}`):
// el contrato da precedencia a health, categorias, tipos, search, etc. sobre /alojamientos/{id}.
// Fase 9.2 (§2 del diseño): viven en catálogo y consultan disponibilidad y reservas por sus puertos.

@ApiTags('Contrato v2 - Telemetría y Salud de Nodo')
@Controller({ path: 'alojamientos', version: '2' })
@UseFilters(ProblemaV2Filter)
export class SaludV2Controller {
  constructor(
    private readonly catalogo: CatalogoPuerto,
    private readonly disponibilidad: DisponibilidadPuerto,
  ) {}

  @Get('health')
  @ApiOperation({ operationId: 'getHealth', summary: 'Healthcheck y telemetría del nodo (semáforo)' })
  async health(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const inicio = Date.now();
    let conectada = true;
    let metricas = { total_propiedades: 0, habitaciones_totales: 0, habitaciones_ocupadas: 0, tasa_ocupacion_pct: 0 };
    try {
      // Propiedades y habitaciones a la venta (catálogo) y su ocupación de hoy (disponibilidad)
      const fila = await Promise.race([
        (async () => {
          const { propiedades, habitacionIds } = await this.catalogo.aLaVenta();
          return { propiedades, ...(await this.disponibilidad.ocupacion(habitacionIds, hoyIso())) };
        })(),
        new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('La base no contestó a tiempo')), 3000).unref()),
      ]);
      metricas = {
        total_propiedades: fila.propiedades,
        habitaciones_totales: fila.totales,
        habitaciones_ocupadas: fila.ocupadas,
        tasa_ocupacion_pct: fila.totales > 0 ? Math.round((fila.ocupadas / fila.totales) * 10000) / 100 : 0,
      };
    } catch (error) {
      conectada = false;
      console.error('[v2/health] falló la comprobación de la base de datos:', (error as Error).message);
    }
    const latencia = Date.now() - inicio;
    // GREEN < 200 ms · YELLOW 200–800 ms · RED > 800 ms o caída
    const semaforo = !conectada || latencia > 800 ? 'RED' : latencia >= 200 ? 'YELLOW' : 'GREEN';
    if (!conectada) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      res.setHeader('Retry-After', '30');
    }
    return {
      status: !conectada ? 'DOWN' : semaforo === 'GREEN' ? 'HEALTHY' : 'DEGRADED',
      semaforo,
      service: 'alojamientos-cozy',
      version: '2.2.0',
      latency_ms: latencia,
      uptime_seconds: Math.round(process.uptime()),
      database: { status: conectada ? 'CONNECTED' : 'DISCONNECTED' },
      circuit_breaker: 'CLOSED',
      metrics: metricas,
      timestamp: new Date().toISOString(),
    };
  }
}

@ApiTags('Contrato v2 - Catálogo y Búsqueda')
@Controller({ path: 'alojamientos', version: '2' })
@UseFilters(ProblemaV2Filter)
@UseInterceptors(EtagV2Interceptor)
export class CatalogoV2Controller {
  constructor(
    private readonly catalogo: CatalogoV2Service,
    private readonly disponibilidad: DisponibilidadPuerto,
    private readonly paquetes: PoliticaPaquetesService,
  ) {}

  @Get('categorias')
  @ApiOperation({ operationId: 'listCategorias', summary: 'Taxonomía de tipos de alojamiento' })
  categorias() {
    return this.catalogo.categorias();
  }

  @Get('tipos')
  @ApiOperation({ operationId: 'listCategorias_alojamientos_tipos', summary: 'Alias deprecado de /alojamientos/categorias', deprecated: true })
  tipos() {
    return this.catalogo.categorias();
  }

  @Post('search')
  @ApiOperation({ operationId: 'searchAlojamientos', summary: 'Búsqueda avanzada con fechas y ocupantes' })
  async buscar(@Body(validacionCuerpoV2()) cuerpo: BuscarAlojamientosV2Dto, @Query(validacionConsultaV2()) pagina: PaginaV2Query, @Res({ passthrough: true }) res: Response) {
    res.status(HttpStatus.OK); // POST de consulta: 200, no 201
    return this.catalogo.buscar(cuerpo, pagina.page, pagina.limit, this.disponibilidad, await this.paquetes.vigente());
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ operationId: 'quoteAvailability', summary: 'Disponibilidad de un tipo de habitación y cotización con precio congelado 30 min' })
  cotizar(@Body(validacionCuerpoV2()) cuerpo: CotizarV2Dto) {
    return this.disponibilidad.cotizar(cuerpo);
  }

  @Get()
  @ApiOperation({ operationId: 'listAlojamientos', summary: 'Catálogo paginado de propiedades de hospedaje' })
  async listar(@Query(validacionConsultaV2()) consulta: ListarAlojamientosV2Query) {
    return this.catalogo.listar(consulta, await this.paquetes.vigente());
  }
}

@ApiTags('Contrato v2 - Propiedades y Habitaciones')
@Controller({ path: 'alojamientos', version: '2' })
@UseFilters(ProblemaV2Filter)
@UseInterceptors(EtagV2Interceptor)
export class AlojamientoV2Controller {
  constructor(
    private readonly catalogo: CatalogoV2Service,
    private readonly disponibilidad: DisponibilidadPuerto,
    private readonly paquetes: PoliticaPaquetesService,
  ) {}

  @Get(':id')
  @ApiOperation({ operationId: 'getAlojamiento', summary: 'Ficha técnica de una propiedad' })
  async ficha(@Param('id', idAlojamientoV2) id: string) {
    return this.catalogo.ficha(id, await this.paquetes.vigente());
  }

  @Get(':id/habitaciones')
  @ApiOperation({ operationId: 'listHabitaciones', summary: 'Tipos de habitación de una propiedad' })
  habitaciones(@Param('id', idAlojamientoV2) id: string) {
    return this.catalogo.habitaciones(id, this.disponibilidad);
  }

  @Get(':id/availability')
  @ApiOperation({ operationId: 'getAvailability', summary: 'Tipos de habitación y planes con cupo y precio para un rango (informativo)' })
  opciones(@Param('id', idAlojamientoV2) id: string, @Query(validacionConsultaV2()) consulta: OpcionesDisponibilidadV2Query) {
    return this.disponibilidad.opciones(id, consulta);
  }

  @Get(':id/disponibilidad')
  @ApiOperation({ operationId: 'getAvailability_alojamientos_id_disponibilidad', summary: 'Alias deprecado de /alojamientos/{id}/availability', deprecated: true })
  opcionesAlias(@Param('id', idAlojamientoV2) id: string, @Query(validacionConsultaV2()) consulta: OpcionesDisponibilidadV2Query) {
    return this.disponibilidad.opciones(id, consulta);
  }
}

