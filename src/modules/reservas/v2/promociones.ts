import { divisionHalfUp } from '../../comun/v2/precios';
import { reglaDeNegocio } from '../../comun/v2/problemas-v2';

// Acuerdo B2B de promociones (contrato v2, §3 y §9 de la cátedra). Funciones puras: las usan el PUT del acuerdo y la
// validación de cada orden con `paquete`.

export interface AcuerdoPromociones {
  permitePromociones: boolean;
  porcentajeMaximo: number;
  // Nombres de ciudad; vacío = todos los destinos
  destinos: string[];
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}

export interface PaqueteDescuento {
  descuentoPorcentaje: number;
  descuentoMonto: string;
}

// Sin acentos ni mayúsculas: "Baños" y "banos" son el mismo destino
export const normalizarDestino = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Porcentajes con 2 decimales comparados como enteros (centésimas de punto): 15 y 15.00 son lo mismo, sin flotantes
export const centesimas = (porcentaje: number): number => Math.round(porcentaje * 100);

// PUT del acuerdo: si no acepta promociones el porcentaje es 0; la vigencia no puede estar vencida (hoy = fecha de Guayaquil)
export function validarAcuerdoNuevo(permite: boolean, porcentajeMaximo: number, vigenciaHasta: string | undefined, hoy: string): void {
  if (!permite && centesimas(porcentajeMaximo) !== 0) {
    throw reglaDeNegocio('VALIDATION_FAILED', 'Si permite_promociones es false, porcentaje_descuento_maximo debe ser 0.', [
      { name: 'porcentaje_descuento_maximo', reason: 'debe ser 0 cuando permite_promociones es false' },
    ]);
  }
  if (vigenciaHasta && vigenciaHasta < hoy) {
    throw reglaDeNegocio('VALIDATION_FAILED', `vigencia_hasta (${vigenciaHasta}) ya pasó.`, [{ name: 'vigencia_hasta', reason: `debe ser hoy (${hoy}) o posterior` }]);
  }
}

const SIN_ACUERDO = 'El nodo no tiene un acuerdo B2B de promociones vigente: no acepta paquetes.';

// Por qué un acuerdo formalizado no deja vender paquetes hoy (null = rige): permite promociones y está en su vigencia.
// Lo comparten la compra y el catálogo (`permitePaquete`), para que ambos respondan lo mismo.
export function rechazoDeVigencia(acuerdo: AcuerdoPromociones, hoy: string): string | null {
  if (!acuerdo.permitePromociones) return 'permite_promociones=false en el acuerdo B2B vigente.';
  if (acuerdo.vigenciaDesde && hoy < acuerdo.vigenciaDesde) return `El acuerdo B2B rige desde el ${acuerdo.vigenciaDesde}.`;
  if (acuerdo.vigenciaHasta && hoy > acuerdo.vigenciaHasta) return `El acuerdo B2B de promociones venció el ${acuerdo.vigenciaHasta}.`;
  return null;
}

// Lista de destinos vacía = todos; si no, la ciudad del alojamiento debe estar en ella
export function destinoHabilitado(acuerdo: AcuerdoPromociones, destino: string | null): boolean {
  if (acuerdo.destinos.length === 0) return true;
  return destino !== null && acuerdo.destinos.some((d) => normalizarDestino(d) === normalizarDestino(destino));
}

// ¿Un alojamiento de esa ciudad acepta paquetes hoy? No mira el porcentaje: sin un descuento concreto no hay qué comparar
export const aceptaPaquete = (acuerdo: AcuerdoPromociones | null, destino: string | null, hoy: string): boolean =>
  acuerdo !== null && rechazoDeVigencia(acuerdo, hoy) === null && destinoHabilitado(acuerdo, destino);

// Orden con `paquete`: lo que se puede comprobar sin conocer el precio (acuerdo, vigencia, destino, porcentaje)
export function validarPaqueteContraAcuerdo(acuerdo: AcuerdoPromociones | null, paquete: PaqueteDescuento, destino: string | null, hoy: string): void {
  const rechazo = (detalle: string) => reglaDeNegocio('PROMOTIONS_NOT_ALLOWED', detalle, [{ name: 'paquete', reason: detalle }]);
  if (!acuerdo) throw rechazo(SIN_ACUERDO);
  const sinVigencia = rechazoDeVigencia(acuerdo, hoy);
  if (sinVigencia) throw rechazo(sinVigencia);
  if (!destinoHabilitado(acuerdo, destino)) throw rechazo(`El destino '${destino ?? 'sin ciudad'}' no está habilitado para promociones en el acuerdo B2B.`);
  if (centesimas(paquete.descuentoPorcentaje) > centesimas(acuerdo.porcentajeMaximo)) {
    throw reglaDeNegocio(
      'DISCOUNT_EXCEEDS_CONTRACT',
      `descuentoPorcentaje=${paquete.descuentoPorcentaje.toFixed(2)} supera porcentaje_descuento_maximo=${acuerdo.porcentajeMaximo.toFixed(2)}.`,
      [{ name: 'paquete.descuentoPorcentaje', reason: `el máximo pactado es ${acuerdo.porcentajeMaximo.toFixed(2)}` }],
    );
  }
}

// descuentoMonto = round_half_up(subtotal × descuentoPorcentaje / 100), en centavos
export const descuentoEnCentavos = (subtotalCentavos: number, porcentaje: number): number => divisionHalfUp(subtotalCentavos * centesimas(porcentaje), 10_000);
