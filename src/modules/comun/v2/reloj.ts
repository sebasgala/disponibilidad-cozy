import { Injectable } from '@nestjs/common';

// Hora actual, inyectable: las pruebas la reemplazan por un reloj controlado (vencimiento de cotizaciones, CUTOFF).
@Injectable()
export class Reloj {
  ahora(): Date {
    return new Date();
  }
}

// "2026-11-01T14:00:00-05:00": instante con el offset de Guayaquil (UTC−5, sin horario de verano)
export function isoGuayaquil(instante: Date): string {
  const local = new Date(instante.getTime() - 5 * 3_600_000).toISOString().slice(0, 19);
  return `${local}-05:00`;
}

// Fecha (YYYY-MM-DD) que marca el reloj de Guayaquil en ese instante
export const fechaGuayaquil = (instante: Date): string => new Date(instante.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

// Instante en que son las `hora` (HH:MM) de la `fecha` (YYYY-MM-DD) en Guayaquil
export const instanteGuayaquil = (fecha: string, hora: string): Date => new Date(`${fecha}T${hora}:00-05:00`);

// La cotización congela el precio 30 minutos (contrato v2 §3). No retiene inventario.
export const VIGENCIA_COTIZACION_MS = 30 * 60 * 1000;

export const vigenteHasta = (creada: Date): Date => new Date(creada.getTime() + VIGENCIA_COTIZACION_MS);

// Vigente hasta el instante anterior a `validaHasta`: a los 30:00 exactos ya venció
export const estaVigente = (validaHasta: Date, ahora: Date): boolean => ahora.getTime() < validaHasta.getTime();
