import { Injectable } from '@nestjs/common';
import { PoliticaPaquetes } from '../politica-paquetes';
import { ConsultaReservasVigentes } from '../reservas-vigentes.puerto';
import { destinoHabilitado, rechazoDeVigencia } from '../../reservas/v2/promociones';
import { fechaGuayaquil } from '../../comun/v2/reloj';

// permitePaquete del catálogo: el acuerdo B2B (de reservas, consultado por su puerto) convertido en la política que el
// catálogo aplica a cada alojamiento, con la misma regla que valida la compra (vigencia hoy en Guayaquil y destinos habilitados).
@Injectable()
export class PoliticaPaquetesService {
  constructor(private readonly reservas: ConsultaReservasVigentes) {}

  async vigente(ahora = new Date()): Promise<PoliticaPaquetes | null> {
    const acuerdo = await this.reservas.acuerdoPromociones();
    if (!acuerdo || rechazoDeVigencia(acuerdo, fechaGuayaquil(ahora)) !== null) return null;
    return {
      descuentoMaximo: acuerdo.porcentajeMaximo,
      todosLosDestinos: acuerdo.destinos.length === 0,
      aceptaDestino: (ciudad) => destinoHabilitado(acuerdo, ciudad),
    };
  }
}

