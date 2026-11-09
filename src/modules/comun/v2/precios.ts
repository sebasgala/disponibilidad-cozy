// Fórmula de precio del contrato v2 (§4). Todo en centavos enteros: ningún paso usa flotantes con dinero.
//
//   precio de la noche (por habitación) = round_half_up(precio del día × (1 + ajuste del plan))
//                                         + suplemento por adulto extra × adultos sobre la ocupación base
//                                         + suplemento por niño × niños mayores de la edad gratis
//   nochesDetalle[i]  = precio de la noche × habitaciones          (una línea por noche, ya redondeada)
//   subtotal          = suma exacta de nochesDetalle
//   ivaValor          = round_half_up(subtotal × ivaPorcentaje / 100)
//   tasaMunicipal     = USD 2.00 × noches × habitaciones
//   total             = subtotal + ivaValor + tasaMunicipal − descuentoCombo
//
// Cada línea se redondea una vez y las sumas son de enteros, así que el total cuadra exacto (tolerancia 0).

export const IVA_PORCENTAJE = 15;
export const TASA_MUNICIPAL_CENTAVOS = 200; // por noche y por habitación

// round_half_up(numerador / denominador) para enteros no negativos
export function divisionHalfUp(numerador: number, denominador: number): number {
  if (numerador < 0 || denominador <= 0) throw new Error(`División half-up inválida: ${numerador}/${denominador}`);
  return Math.floor((numerador * 2 + denominador) / (denominador * 2));
}

// Ajuste porcentual del plan, en centésimas de punto (−10.00 % = −1000). Resultado redondeado half-up.
export function aplicarAjuste(centavos: number, ajusteCentesimas: number): number {
  if (ajusteCentesimas <= -10000) throw new Error(`Ajuste inválido: ${ajusteCentesimas / 100} %`);
  return divisionHalfUp(centavos * (10000 + ajusteCentesimas), 10000);
}

export const ivaDe = (subtotalCentavos: number, porcentaje = IVA_PORCENTAJE): number => divisionHalfUp(subtotalCentavos * porcentaje, 100);

// Reparte los adultos entre las habitaciones lo más parejo posible: 5 en 2 => [3, 2]
export function repartir(total: number, habitaciones: number): number[] {
  return Array.from({ length: habitaciones }, (_, i) => Math.floor(total / habitaciones) + (i < total % habitaciones ? 1 : 0));
}

export interface PlanPrecio {
  ajusteCentesimas: number; // ajuste sobre el precio del día, en centésimas de punto porcentual
  ocupacionBase: number; // adultos incluidos por habitación
  suplementoAdultoExtraCentavos: number; // por noche y por adulto sobre la ocupación base
  edadMaximaGratis: number; // niños de esta edad o menos no pagan suplemento
  suplementoNinoCentavos: number; // por noche y por niño mayor de esa edad
}

export interface EntradaPrecio {
  noches: { fecha: string; precioCentavos: number }[]; // precio del día por habitación, en orden de fecha
  plan: PlanPrecio;
  habitaciones: number;
  adultos: number;
  edadesNinos: number[]; // si no se conocen las edades, el que llama decide qué edad suponer
  descuentoComboCentavos?: number;
  ivaPorcentaje?: number;
}

export interface DesglosePrecio {
  nochesDetalle: { fecha: string; centavos: number }[];
  precioNocheCentavos: number; // promedio por noche y por habitación, half-up (informativo)
  subtotal: number;
  ivaPorcentaje: number;
  ivaValor: number;
  tasaMunicipal: number;
  descuentoCombo: number;
  total: number;
}

export function calcularPrecio(e: EntradaPrecio): DesglosePrecio {
  if (e.noches.length === 0) throw new Error('La estancia necesita al menos una noche');
  if (!Number.isInteger(e.habitaciones) || e.habitaciones < 1) throw new Error(`Habitaciones inválidas: ${e.habitaciones}`);
  const ivaPorcentaje = e.ivaPorcentaje ?? IVA_PORCENTAJE;

  // Suplementos por noche, sumando todas las habitaciones
  const adultosExtra = repartir(e.adultos, e.habitaciones).reduce((n, a) => n + Math.max(0, a - e.plan.ocupacionBase), 0);
  const ninosQuePagan = e.edadesNinos.filter((edad) => edad > e.plan.edadMaximaGratis).length;
  const suplementosPorNoche = adultosExtra * e.plan.suplementoAdultoExtraCentavos + ninosQuePagan * e.plan.suplementoNinoCentavos;

  const nochesDetalle = e.noches.map(({ fecha, precioCentavos }) => ({
    fecha,
    centavos: aplicarAjuste(precioCentavos, e.plan.ajusteCentesimas) * e.habitaciones + suplementosPorNoche,
  }));
  const subtotal = nochesDetalle.reduce((s, n) => s + n.centavos, 0);
  const ivaValor = ivaDe(subtotal, ivaPorcentaje);
  const tasaMunicipal = TASA_MUNICIPAL_CENTAVOS * e.noches.length * e.habitaciones;
  const descuentoCombo = e.descuentoComboCentavos ?? 0;
  const total = subtotal + ivaValor + tasaMunicipal - descuentoCombo;
  if (total < 0) throw new Error('El descuento no puede superar el total');

  return {
    nochesDetalle,
    precioNocheCentavos: divisionHalfUp(subtotal, e.noches.length * e.habitaciones),
    subtotal,
    ivaPorcentaje,
    ivaValor,
    tasaMunicipal,
    descuentoCombo,
    total,
  };
}
