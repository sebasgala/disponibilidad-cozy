import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Any, FindOptionsWhere, Repository } from 'typeorm';
import { Alojamiento } from './entities/alojamiento.entity';
import { Habitacion } from './entities/habitacion.entity';
import { SearchAccommodationRequestDto, SearchAccommodationResponseDto } from './dto/search-accommodation.dto';
import {
  AccommodationDetailsItemDto,
  AccommodationDetailsRequestDto,
  AccommodationDetailsResponseDto,
  DETAILS_EXTRAS,
} from './dto/accommodation-details.dto';
import { RecursoNoEncontradoException } from '../comun/problems/problem-details.exceptions';
import {
  calcularNoches,
  codificarPagina,
  decodificarPagina,
  exigirFechaNoPasada,
  esIdPosible,
  repartirHuespedes,
  urlAlojamiento,
} from '../comun/alojamientos-consulta.utils';
import { FuenteDisponibilidad } from './fuente-disponibilidad';
import { CONEXION } from '../../database/conexiones';

@Injectable()
export class AlojamientosService {
  constructor(
    @InjectRepository(Alojamiento, CONEXION.catalogo)
    private readonly alojamientosRepository: Repository<Alojamiento>,
    @InjectRepository(Habitacion, CONEXION.catalogo)
    private readonly habitacionesRepository: Repository<Habitacion>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo
  // ═══════════════════════════════════════════════════════════════════════

  // Alojamientos activos con al menos una habitación disponible en TODAS las noches del rango
  // [checkin, checkout), con cupos suficientes y donde caben los huéspedes. Qué habitaciones tienen cupo lo dice
  // `fuente` (disponibilidad); el catálogo filtra por ciudad, país y capacidad, y pagina.
  async search(searchRequest: SearchAccommodationRequestDto, fuente: FuenteDisponibilidad): Promise<SearchAccommodationResponseDto> {
    const noches = calcularNoches(searchRequest.checkin, searchRequest.checkout);
    exigirFechaNoPasada(searchRequest.checkin, 'checkin');
    const rows = searchRequest.rows ?? 100;
    const offset = decodificarPagina(searchRequest.page);
    const reparto = repartirHuespedes(searchRequest.guests);
    const respuesta: SearchAccommodationResponseDto = { request_id: randomUUID(), data: [], next_page: null };

    // Un id de ciudad fuera del rango de integer no puede existir.
    if (searchRequest.city !== undefined && !esIdPosible(searchRequest.city)) return respuesta;

    const consulta = this.alojamientosRepository
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .leftJoin('a.ciudad', 'c')
      .where('a.activo = :activo', { activo: true });
    if (searchRequest.city !== undefined) consulta.andWhere('a.ciudadId = :ciudad', { ciudad: searchRequest.city });
    if (searchRequest.country) consulta.andWhere('c.pais = :pais', { pais: searchRequest.country });

    const conCupo = [...(await fuente.ofertas({ checkin: searchRequest.checkin, checkout: searchRequest.checkout, noches, cupos: reparto.habitaciones })).keys()];
    if (conCupo.length === 0) return respuesta;
    const hayHabitacionDisponible = consulta
      .subQuery()
      .select('1')
      .from(Habitacion, 'h')
      .where('h.alojamientoId = a.id')
      .andWhere('h.activo = true')
      .andWhere('h.capacidadAdultos >= :adultos')
      .andWhere('h.capacidadNinos >= :ninos')
      .andWhere('h.id IN (:...conCupo)')
      .getQuery();

    const filas = await consulta
      .andWhere(`EXISTS ${hayHabitacionDisponible}`)
      .setParameters({
        adultos: reparto.adultosPorHabitacion,
        ninos: reparto.ninosPorHabitacion,
        conCupo,
      })
      .orderBy('a.id', 'ASC')
      .offset(offset)
      .limit(rows + 1) // una de más, solo para saber si hay otra página
      .getRawMany<{ id: number }>();

    respuesta.data = filas.slice(0, rows).map((fila) => ({ id: Number(fila.id), url: urlAlojamiento(Number(fila.id)) }));
    respuesta.next_page = filas.length > rows ? codificarPagina(offset + rows) : null;
    return respuesta;
  }

  getDetailsChanges(changesRequest: any): any {
    // TODO: Implementar consulta de cambios de alojamientos desde una fecha
    return { request_id: '', data: {} };
  }

  getChains(): any {
    // TODO: Implementar listado de cadenas hoteleras y marcas
    return { request_id: '', data: [] };
  }

  getConstants(constantsRequest: any): any {
    // TODO: Implementar consulta de constantes del sistema (facilidades, tipos de cuartos)
    return { request_id: '', data: {} };
  }

  getReviews(reviewsRequest: any): any {
    // TODO: Implementar obtención de reseñas de alojamientos
    return { request_id: '', data: [], next_page: null };
  }

  getReviewsScores(scoresRequest: any): any {
    // TODO: Implementar obtención de puntuaciones de reseñas
    return { request_id: '', data: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Disponibilidad y Precios
  // ═══════════════════════════════════════════════════════════════════════

  checkBulkAvailability(bulkRequest: any): any {
    // TODO: Implementar consulta de disponibilidad múltiple
    return { request_id: '', data: [] };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Búsqueda y Catálogo: detalles
  // ═══════════════════════════════════════════════════════════════════════

  // Ficha de los alojamientos activos: por ids (si alguno no existe o está inactivo, 404) o por ciudad/país.
  // Dos consultas en total (alojamientos con su ciudad + habitaciones de todos), sin N+1.
  async getDetails(detailsRequest: AccommodationDetailsRequestDto): Promise<AccommodationDetailsResponseDto> {
    const extras = new Set<string>(detailsRequest.extras?.length ? detailsRequest.extras : DETAILS_EXTRAS);
    const ids = detailsRequest.accommodations?.length ? [...new Set(detailsRequest.accommodations)] : undefined;
    let alojamientos: Alojamiento[] = [];

    if (ids) {
      const posibles = ids.filter(esIdPosible);
      if (posibles.length > 0) {
        alojamientos = await this.alojamientosRepository.find({
          where: { id: Any(posibles), activo: true },
          relations: { ciudad: true },
          order: { id: 'ASC' },
        });
      }
      const encontrados = new Set(alojamientos.map((a) => a.id));
      const faltantes = ids.filter((id) => !encontrados.has(id));
      if (faltantes.length > 0) {
        const reason = `No existen o están inactivos: ${faltantes.join(', ')}`;
        throw new RecursoNoEncontradoException(`Alojamientos no encontrados: ${faltantes.join(', ')}`, [
          { name: 'accommodations', reason },
        ]);
      }
    } else if (detailsRequest.city === undefined || esIdPosible(detailsRequest.city)) {
      const where: FindOptionsWhere<Alojamiento> = { activo: true };
      if (detailsRequest.city !== undefined) where.ciudadId = detailsRequest.city;
      if (detailsRequest.country) where.ciudad = { pais: detailsRequest.country };
      alojamientos = await this.alojamientosRepository.find({ where, relations: { ciudad: true }, order: { id: 'ASC' } });
    }

    const habitacionesPorAlojamiento = new Map<number, Habitacion[]>();
    if (extras.has('rooms') && alojamientos.length > 0) {
      const habitaciones = await this.habitacionesRepository.find({
        where: { alojamientoId: Any(alojamientos.map((a) => a.id)), activo: true },
        order: { precioBase: 'ASC', nombre: 'ASC' },
      });
      for (const h of habitaciones) {
        habitacionesPorAlojamiento.set(h.alojamientoId, [...(habitacionesPorAlojamiento.get(h.alojamientoId) ?? []), h]);
      }
    }

    const data = alojamientos.map((a): AccommodationDetailsItemDto => {
      const ficha: AccommodationDetailsItemDto = {
        id: a.id,
        name: a.nombre,
        city: a.ciudad ? { id: a.ciudad.id, name: a.ciudad.nombre, country: a.ciudad.pais } : null,
        currency: a.moneda,
      };
      if (extras.has('description')) ficha.description = a.descripcion;
      if (extras.has('photos')) ficha.photos = a.fotos;
      if (extras.has('facilities')) ficha.facilities = a.facilidades;
      if (extras.has('policies')) ficha.policies = a.politicas;
      if (extras.has('rooms')) {
        ficha.rooms = (habitacionesPorAlojamiento.get(a.id) ?? []).map((h) => ({
          product_id: h.id,
          name: h.nombre,
          type: h.tipo,
          max_adults: h.capacidadAdultos,
          max_children: h.capacidadNinos,
          base_price: h.precioBase,
          meal_plan: h.mealPlan,
          cancellation_type: h.cancellationType,
        }));
      }
      return ficha;
    });

    return { request_id: randomUUID(), data, next_page: null };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Gestión de Órdenes (Reservas): preview, create, get y cancel están en OrdenesService
  // ═══════════════════════════════════════════════════════════════════════

  modifyOrder(orderId: string, modifyRequest: any): any {
    // TODO: Implementar modificación de orden existente
    return {};
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Webhooks
  // ═══════════════════════════════════════════════════════════════════════

  listWebhooks(): any[] {
    // TODO: Implementar listado de suscripciones a webhooks
    return [];
  }

  createWebhook(webhookSubscription: any): any {
    // TODO: Implementar registro de webhook
    return {};
  }

  deleteWebhook(id: string): void {
    // TODO: Implementar eliminación de suscripción de webhook
  }
}
