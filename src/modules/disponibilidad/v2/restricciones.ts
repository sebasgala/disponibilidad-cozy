// Restricciones de venta por noche (contrato v2 §4.1). Se evalúan en POST /availability y en orders/create.
//
//   MIN_STAY / MAX_STAY   noche de llegada     noches ∈ [estanciaMinima, estanciaMaxima]
//   CLOSED_TO_ARRIVAL     noche de llegada     cerradoALlegada = false
//   CLOSED_TO_DEPARTURE   fecha de salida      cerradoASalida = false
//   STOP_SELL             cada noche           ventaCerrada = false
//   CUTOFF                ahora vs 14:00 de la llegada (Guayaquil)   horas ≥ anticipacionMinimaHoras
//
// Una noche sin fila de restricciones no restringe nada (los valores por defecto del contrato).

export type CodigoRestriccion = 'MIN_STAY' | 'MAX_STAY' | 'CLOSED_TO_ARRIVAL' | 'CLOSED_TO_DEPARTURE' | 'STOP_SELL' | 'CUTOFF';

export interface RestriccionNoche {
  fecha: string;
  estanciaMinima?: number | null;
  estanciaMaxima?: number | null;
  cerradoALlegada?: boolean;
  cerradoASalida?: boolean;
  ventaCerrada?: boolean;
  anticipacionMinimaHoras?: number | null;
}

export interface Violacion {
  restriccion: CodigoRestriccion;
  fecha: string;
  detalle: string;
}

// La hora de llegada del contrato: 14:00 en Guayaquil (UTC−5, sin horario de verano)
export const instanteDeLlegada = (fecha: string): Date => new Date(`${fecha}T14:00:00-05:00`);

const MS_POR_HORA = 3_600_000;

// Devuelve la primera restricción violada, o null. `noches` son las fechas de la estancia [inicio, fin).
export function evaluarRestricciones(
  noches: string[],
  fechaFin: string,
  restricciones: Map<string, RestriccionNoche>,
  ahora: Date,
): Violacion | null {
  const llegada = noches[0];
  const r = restricciones.get(llegada);
  if (r?.cerradoALlegada) return { restriccion: 'CLOSED_TO_ARRIVAL', fecha: llegada, detalle: `No se admiten llegadas el ${llegada}.` };
  if (r?.estanciaMinima && noches.length < r.estanciaMinima) {
    return { restriccion: 'MIN_STAY', fecha: llegada, detalle: `Llegando el ${llegada} la estancia mínima es de ${r.estanciaMinima} noches.` };
  }
  if (r?.estanciaMaxima && noches.length > r.estanciaMaxima) {
    return { restriccion: 'MAX_STAY', fecha: llegada, detalle: `Llegando el ${llegada} la estancia máxima es de ${r.estanciaMaxima} noches.` };
  }
  if (r?.anticipacionMinimaHoras) {
    const horas = (instanteDeLlegada(llegada).getTime() - ahora.getTime()) / MS_POR_HORA;
    if (horas < r.anticipacionMinimaHoras) {
      return { restriccion: 'CUTOFF', fecha: llegada, detalle: `Para llegar el ${llegada} hay que reservar con ${r.anticipacionMinimaHoras} horas de anticipación.` };
    }
  }
  const cerrada = noches.find((f) => restricciones.get(f)?.ventaCerrada);
  if (cerrada) return { restriccion: 'STOP_SELL', fecha: cerrada, detalle: `La venta está cerrada para la noche del ${cerrada}.` };
  if (restricciones.get(fechaFin)?.cerradoASalida) {
    return { restriccion: 'CLOSED_TO_DEPARTURE', fecha: fechaFin, detalle: `No se admiten salidas el ${fechaFin}.` };
  }
  return null;
}
