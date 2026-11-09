import { ConflictoException } from '../comun/problems/problem-details.exceptions';

export interface AcuerdoPromocionesVigentes {
  permitePromociones: boolean;
  porcentajeMaximo: number;
  destinos: string[];
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}

// Lo que el catálogo necesita saber de reservas para dar de baja (fase 8.0): los localizadores de las reservas
// vigentes de una habitación o de un alojamiento, y el acuerdo B2B vigente para permitePaquete (fase 9.2).
// El catálogo declara la pregunta; reservas la responde (ReservasPuertosModule en el monolito o ReservasVigentesHttp en el proceso separado).
// Desde 8.4 (E3) no recibe la transacción del catálogo: se pregunta ANTES de abrirla, como las lecturas del catálogo
// desde otros dominios (D1 de 8.2). La carrera entre la pregunta y la baja la cubre la alerta de bajas (D2 de 8.2).
export abstract class ConsultaReservasVigentes {
  abstract localizadores(filtro: { habitacionId: string } | { alojamientoId: number }): Promise<string[]>;

  acuerdoPromociones(): Promise<AcuerdoPromocionesVigentes | null> {
    return Promise.resolve(null);
  }
}

// 409 si hay reservas vigentes: primero hay que cancelarlas (POST /admin/reservas/{id}/cancelar).
export async function exigirSinReservasVigentes(
  consulta: ConsultaReservasVigentes,
  filtro: { habitacionId: string } | { alojamientoId: number },
  queSeDaDeBaja: string,
): Promise<void> {
  const localizadores = await consulta.localizadores(filtro);
  if (localizadores.length === 0) return;
  const lista = localizadores.slice(0, 20).join(', ') + (localizadores.length > 20 ? '…' : '');
  const detalle =
    `No se puede dar de baja ${queSeDaDeBaja}: tiene ${localizadores.length} ` +
    `${localizadores.length === 1 ? 'reserva confirmada vigente' : 'reservas confirmadas vigentes'} (${lista}). ` +
    'Cancélalas primero (POST /admin/reservas/{id}/cancelar).';
  throw new ConflictoException('VALIDATION_FAILED', detalle, [{ name: 'reservas', reason: detalle }]);
}
