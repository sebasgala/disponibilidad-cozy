import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { CatalogoPuerto } from './catalogo.puerto';
import { AvailabilityProductDto, AvailabilityRequestDto, AvailabilityResponseDto } from './dto/availability.dto';
import { DisponibilidadPuerto } from '../disponibilidad/disponibilidad.puerto';
import { calcularNoches, construirProductId, exigirFechaNoPasada, repartirHuespedes, urlAlojamiento } from '../comun/alojamientos-consulta.utils';
import { RecursoNoEncontradoException } from '../comun/problems/problem-details.exceptions';

// POST /availability del contrato v1: el alojamiento lo da el catálogo y las habitaciones libres con su precio,
// disponibilidad (que pide al catálogo cuáles están activas y dónde caben los huéspedes).
@Injectable()
export class ConsultasV1Service {
  constructor(
    private readonly catalogo: CatalogoPuerto,
    private readonly disponibilidad: DisponibilidadPuerto,
  ) {}

  async checkAvailability(availabilityRequest: AvailabilityRequestDto): Promise<AvailabilityResponseDto> {
    const noches = calcularNoches(availabilityRequest.checkin, availabilityRequest.checkout);
    exigirFechaNoPasada(availabilityRequest.checkin, 'checkin');
    const reparto = repartirHuespedes(availabilityRequest.guests);
    const alojamiento = await this.catalogo.alojamientoActivoPorId(availabilityRequest.accommodation);
    if (!alojamiento) {
      const reason = `El alojamiento ${availabilityRequest.accommodation} no existe o está inactivo`;
      throw new RecursoNoEncontradoException(reason, [{ name: 'accommodation', reason }]);
    }

    const disponibles = await this.disponibilidad.habitacionesDisponibles({
      alojamientoId: alojamiento.id,
      checkin: availabilityRequest.checkin,
      checkout: availabilityRequest.checkout,
      noches,
      reparto,
    });

    const products: AvailabilityProductDto[] = disponibles.map((h) => ({
      product_id: construirProductId(h.id, availabilityRequest.checkin, availabilityRequest.checkout),
      name: h.nombre,
      type: h.tipo,
      meal_plan: h.mealPlan,
      cancellation_type: h.cancellationType,
      max_adults: h.capacidadAdultos,
      max_children: h.capacidadNinos,
      rooms_left: h.cuposMinimos,
      price: { currency: alojamiento.moneda, total: h.total, nights: h.noches },
    }));

    return {
      request_id: randomUUID(),
      data: { id: alojamiento.id, currency: alojamiento.moneda, products, url: urlAlojamiento(alojamiento.id) },
    };
  }
}

