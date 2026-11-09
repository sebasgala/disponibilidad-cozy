import { calcularNoches, esFechaValida, hoyIso } from '../alojamientos-consulta.utils';
import { peticionInvalida, reglaDeNegocio } from './problemas-v2';

// Reglas de estancia del contrato v2 (§4): 1 ≤ noches ≤ 30, fechaFin > fechaInicio y fechaInicio ≥ hoy (Guayaquil).
// Una fecha imposible (2026-02-30) viola el esquema (400); las demás reglas son de negocio (422).
export const MAX_NOCHES = 30;

const MS_POR_DIA = 86_400_000;

export interface NombresFechas {
  inicio: string;
  fin: string;
}

// Devuelve las noches de la estancia: [inicio, fin), una fecha por noche
export function validarEstancia(inicio: string, fin: string, nombres: NombresFechas = { inicio: 'fechaInicio', fin: 'fechaFin' }): string[] {
  if (!esFechaValida(inicio)) throw peticionInvalida([{ name: nombres.inicio, reason: 'debe ser una fecha válida YYYY-MM-DD' }]);
  if (!esFechaValida(fin)) throw peticionInvalida([{ name: nombres.fin, reason: 'debe ser una fecha válida YYYY-MM-DD' }]);
  if (fin <= inicio) {
    throw reglaDeNegocio('VALIDATION_FAILED', `${nombres.fin} debe ser posterior a ${nombres.inicio}.`, [{ name: nombres.fin, reason: `debe ser posterior a ${nombres.inicio}` }]);
  }
  const hoy = hoyIso();
  if (inicio < hoy) {
    throw reglaDeNegocio('VALIDATION_FAILED', `${nombres.inicio} (${inicio}) ya pasó.`, [{ name: nombres.inicio, reason: `debe ser hoy (${hoy}) o posterior` }]);
  }
  const noches = calcularNoches(inicio, fin);
  if (noches > MAX_NOCHES) {
    throw reglaDeNegocio('VALIDATION_FAILED', `La estancia máxima es de ${MAX_NOCHES} noches.`, [{ name: nombres.fin, reason: `la estancia no puede superar ${MAX_NOCHES} noches` }]);
  }
  const base = Date.parse(`${inicio}T00:00:00Z`);
  return Array.from({ length: noches }, (_, i) => new Date(base + i * MS_POR_DIA).toISOString().slice(0, 10));
}

// Este nodo opera solo en USD (contrato v2 §1): otra moneda => 422 UNSUPPORTED_CURRENCY
export function exigirUsd(moneda: string | undefined, campo = 'currency'): void {
  if (moneda && moneda !== 'USD') {
    throw reglaDeNegocio('UNSUPPORTED_CURRENCY', `Este nodo solo opera en USD (se pidió ${moneda}).`, [{ name: campo, reason: 'solo se admite USD' }]);
  }
}
