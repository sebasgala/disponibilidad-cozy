import {
  Controller, Post, Body, Headers, Res,
  UseFilters, UsePipes, HttpCode, HttpStatus, Header,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags, ApiOperation, ApiResponse,
  ApiHeader, ApiSecurity, ApiBody, ApiExtraModels, getSchemaPath,
} from '@nestjs/swagger';
import { AlojamientosService } from './alojamientos.service';
import { SearchAccommodationRequestDto, SearchAccommodationResponseDto } from './dto/search-accommodation.dto';
import { AvailabilityRequestDto, AvailabilityResponseDto } from './dto/availability.dto';
import { AccommodationDetailsRequestDto, AccommodationDetailsResponseDto } from './dto/accommodation-details.dto';
import { ProblemDetailsDto } from '../comun/dto/problem-details.dto';
import { ProblemDetailsFilter } from '../comun/problems/problem-details.filter';
import { ConsultaInvalidaException } from '../comun/problems/problem-details.exceptions';
import { validacionContrato } from '../comun/problems/validacion.pipes';
import { DisponibilidadPuerto } from '../disponibilidad/disponibilidad.puerto';
import { ConsultasV1Service } from './consultas-v1.service';

// ─────────────────────────────────────────────────────────────────────────────
// Controlador de Búsqueda, Disponibilidad y Detalles del Catálogo v1 (fase 9.2)
// Alineado 1:1 con alojamientos-openapi.yaml. Las rutas de órdenes v1 viven en reservas (OrdenesV1Controller).
// ─────────────────────────────────────────────────────────────────────────────

const respuestaProblema = (status: number, description: string) => ({
  status,
  description,
  content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDetailsDto) } } },
});

const CABECERAS_200 = {
  'Cache-Control': { description: 'Caché pública de 5 minutos', schema: { type: 'string', example: 'public, max-age=300' } },
  'X-API-Deprecation-Date': {
    description: 'Fecha prevista de baja de esta versión de la API',
    schema: { type: 'string', format: 'date', example: '2027-12-31' },
  },
};

const CABECERAS_CATALOGO = {
  'Cache-Control': 'public, max-age=300',
  'X-API-Deprecation-Date': '2027-12-31',
};

const BOOKER_EJEMPLO = { country: 'ec', platform: 'desktop' };

@ApiExtraModels(ProblemDetailsDto)
@UsePipes(validacionContrato())
@Controller()
export class AlojamientosController {
  constructor(
    private readonly alojamientosService: AlojamientosService,
    private readonly disponibilidad: DisponibilidadPuerto,
    private readonly consultas: ConsultasV1Service,
  ) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Búsqueda de alojamientos',
    description:
      'Devuelve los alojamientos activos con al menos una habitación libre todas las noches de [checkin, checkout) ' +
      'donde caben los huéspedes. Filtra por `city` (id entero) y/o `country`. Paginado con `rows` y `page`/`next_page`. ' +
      'No se convierte moneda: `currency`, `extras`, `booker` y `allocation` se validan pero no cambian el resultado.',
  })
  @ApiHeader({ name: 'X-Device-Fingerprint', required: true, description: 'Identificador del dispositivo', example: 'dev-1234' })
  @ApiBody({
    type: SearchAccommodationRequestDto,
    examples: {
      'Quito, 3 noches (incluye fin de semana)': {
        value: {
          booker: BOOKER_EJEMPLO,
          checkin: '2026-10-09',
          checkout: '2026-10-12',
          city: 1,
          guests: { number_of_adults: 2, number_of_rooms: 1, children: [5] },
          rows: 10,
        },
      },
      'Todo Ecuador, sin niños': {
        value: {
          booker: BOOKER_EJEMPLO,
          checkin: '2026-10-20',
          checkout: '2026-10-22',
          country: 'ec',
          guests: { number_of_adults: 1, number_of_rooms: 1 },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Alojamientos encontrados', type: SearchAccommodationResponseDto, headers: CABECERAS_200 })
  @ApiResponse(respuestaProblema(400, 'Petición inválida (campos faltantes o mal formados, checkout no posterior a checkin, cabecera ausente)'))
  @ApiResponse({ status: 429, description: 'Demasiadas peticiones (pendiente: todavía no hay límite de tasa)' })
  async search(
    @Headers('X-Device-Fingerprint') deviceFingerprint: string,
    @Body() searchRequest: SearchAccommodationRequestDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!deviceFingerprint?.trim()) {
      throw new ConsultaInvalidaException([{ name: 'X-Device-Fingerprint', reason: 'La cabecera X-Device-Fingerprint es obligatoria' }]);
    }
    const resultado = await this.alojamientosService.search(searchRequest, this.disponibilidad);
    res.set(CABECERAS_CATALOGO);
    return resultado;
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Disponibilidad y Precios')
  @ApiOperation({
    summary: 'Consultar disponibilidad y precio de un alojamiento',
    description:
      'Habitaciones del alojamiento libres todas las noches de [checkin, checkout) donde caben los huéspedes. ' +
      '`price.total` es la suma de las noches de disponibilidad_diaria, por habitación, en la moneda del alojamiento. ' +
      'Un alojamiento inexistente o inactivo responde 404.',
  })
  @ApiBody({
    type: AvailabilityRequestDto,
    examples: {
      'Cozy Boutique Quito, fin de semana': {
        value: {
          accommodation: 1,
          booker: BOOKER_EJEMPLO,
          checkin: '2026-10-09',
          checkout: '2026-10-12',
          guests: { number_of_adults: 2, number_of_rooms: 1, children: [5] },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Disponibilidad y detalles del precio', type: AvailabilityResponseDto })
  @ApiResponse(respuestaProblema(400, 'Petición inválida'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe o está inactivo'))
  availability(@Body() availabilityRequest: AvailabilityRequestDto) {
    return this.consultas.checkAvailability(availabilityRequest);
  }

  @Post('bulk-availability')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Disponibilidad y Precios')
  @ApiOperation({
    summary: 'Consultar disponibilidad múltiple de alojamientos',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe BulkAvailabilityRequest del contrato.',
  })
  @ApiResponse({ status: 200, description: 'Disponibilidad para múltiples alojamientos' })
  bulkAvailability(@Body() bulkRequest: any) {
    return this.alojamientosService.checkBulkAvailability(bulkRequest);
  }

  @Post('details')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ProblemDetailsFilter)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Obtener detalles extendidos de los alojamientos',
    description:
      'Ficha de los alojamientos activos: por `accommodations` (ids enteros; si alguno no existe o está inactivo, 404) ' +
      'o por `city`/`country`. `extras` elige los bloques (description, photos, facilities, policies, rooms); ' +
      'si se omite se devuelven todos. `bundles` y `payment` no existen en nuestro modelo y se ignoran.',
  })
  @ApiBody({
    type: AccommodationDetailsRequestDto,
    examples: {
      'Ficha completa de dos alojamientos': { value: { accommodations: [1, 3] } },
      'Solo fotos y habitaciones de una ciudad': { value: { city: 1, extras: ['photos', 'rooms'] } },
    },
  })
  @ApiResponse({ status: 200, description: 'Detalles de los alojamientos solicitados', type: AccommodationDetailsResponseDto, headers: CABECERAS_200 })
  @ApiResponse(respuestaProblema(400, 'Petición inválida'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: algún alojamiento pedido no existe o está inactivo'))
  async getDetails(@Body() detailsRequest: AccommodationDetailsRequestDto, @Res({ passthrough: true }) res: Response) {
    const resultado = await this.alojamientosService.getDetails(detailsRequest);
    res.set(CABECERAS_CATALOGO);
    return resultado;
  }

  @Post('details/changes')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Búsqueda y Catálogo')
  @ApiSecurity('OAuth2Security', ['alojamientos:read'])
  @ApiOperation({
    summary: 'Obtener alojamientos que han cambiado desde una fecha',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe DetailsChangesRequest del contrato. Pide el scope OAuth2 alojamientos:read (pendiente).',
  })
  @ApiResponse({ status: 200, description: 'Lista de alojamientos modificados' })
  getDetailsChanges(@Body() changesRequest: any) {
    return this.alojamientosService.getDetailsChanges(changesRequest);
  }

  @Post('chains')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Listar cadenas hoteleras y sus marcas',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Responde con Cache-Control de 1 hora.',
  })
  @ApiResponse({ status: 200, description: 'Lista de cadenas hoteleras' })
  @Header('Cache-Control', 'public, max-age=3600')
  getChains() {
    return this.alojamientosService.getChains();
  }

  @Post('constants')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Componentes Comunes')
  @ApiOperation({
    summary: 'Consultar constantes del sistema (facilidades, tipos de cuartos, etc.)',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe ConstantsRequest del contrato. Responde con Cache-Control de 24 horas.',
  })
  @ApiResponse({ status: 200, description: 'Constantes del sistema' })
  @Header('Cache-Control', 'public, max-age=86400')
  getConstants(@Body() constantsRequest: any) {
    return this.alojamientosService.getConstants(constantsRequest);
  }

  @Post('reviews')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Obtener reseñas de alojamientos',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe ReviewsRequest del contrato. Responde con Cache-Control de 10 minutos.',
  })
  @ApiResponse({ status: 200, description: 'Reseñas de los alojamientos' })
  @Header('Cache-Control', 'public, max-age=600')
  getReviews(@Body() reviewsRequest: any) {
    return this.alojamientosService.getReviews(reviewsRequest);
  }

  @Post('reviews/scores')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Búsqueda y Catálogo')
  @ApiOperation({
    summary: 'Obtener puntuaciones de reseñas',
    description:
      'Ruta del contrato con datos de RELLENO: todavía no usa la base de datos y el cuerpo no se valida. Recibe ReviewsScoresRequest del contrato. Responde con Cache-Control de 10 minutos.',
  })
  @ApiResponse({ status: 200, description: 'Puntuaciones desglosadas' })
  @Header('Cache-Control', 'public, max-age=600')
  getReviewsScores(@Body() scoresRequest: any) {
    return this.alojamientosService.getReviewsScores(scoresRequest);
  }
}

