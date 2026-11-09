import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { ConsultaInvalidaException } from './problems/problem-details.exceptions';

// Mayor valor que cabe en una columna integer de PostgreSQL
export const ID_MAXIMO = 2147483647;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Evita que un número enorme enviado por el cliente rompa la consulta (integer fuera de rango).
export function acotarEntero(valor: number): number {
  return Math.min(valor, ID_MAXIMO);
}

// Un id solo puede existir si cabe en la columna integer.
export function esIdPosible(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= ID_MAXIMO;
}

// Noches de la estancia [checkin, checkout). Si checkout no es posterior a checkin, 400.
export function calcularNoches(checkin: string, checkout: string): number {
  const noches = Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / MS_POR_DIA);
  if (!(noches >= 1)) {
    throw new ConsultaInvalidaException([{ name: 'checkout', reason: 'checkout debe ser posterior a checkin' }]);
  }
  return noches;
}

// "Hoy" en la zona horaria del negocio (Ecuador continental por defecto), no en UTC: a las 20:00 en Quito
// ya es el día siguiente en UTC. ZONA_HORARIA permite cambiarla.
const ZONA_HORARIA = process.env.ZONA_HORARIA?.trim() || 'America/Guayaquil';

export function hoyIso(): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Una fecha de entrada (o de disponibilidad) anterior a hoy no se puede reservar ni editar: 400.
export function exigirFechaNoPasada(fecha: string, parametro: string, descripcion = 'checkin'): void {
  const hoy = hoyIso();
  if (fecha < hoy) {
    throw new ConsultaInvalidaException([{ name: parametro, reason: `${descripcion} (${fecha}) ya pasó: debe ser hoy (${hoy}) o posterior` }]);
  }
}

// Huéspedes que le tocan a cada habitación: el reparto es parejo (hacia arriba).
// Con una sola habitación son simplemente todos los adultos y todos los niños.
export function repartirHuespedes(guests: { number_of_adults: number; number_of_rooms: number; children?: number[] }) {
  const habitaciones = guests.number_of_rooms;
  const ninos = guests.children?.length ?? 0;
  return {
    habitaciones: acotarEntero(habitaciones),
    adultosPorHabitacion: acotarEntero(Math.ceil(guests.number_of_adults / habitaciones)),
    ninosPorHabitacion: acotarEntero(Math.ceil(ninos / habitaciones)),
  };
}

// El token de página es opaco para el cliente: contiene la posición (offset) de la siguiente página.
export function codificarPagina(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

export function decodificarPagina(page?: string): number {
  if (page === undefined || page === '') return 0;
  try {
    const { offset } = JSON.parse(Buffer.from(page, 'base64url').toString('utf8'));
    if (Number.isInteger(offset) && offset >= 0 && offset <= ID_MAXIMO) return offset;
  } catch {
    // cae al error de abajo
  }
  throw new ConsultaInvalidaException([{ name: 'page', reason: 'El token de página no es válido' }]);
}

export function urlAlojamiento(id: number): string {
  return `/api/v1/alojamientos/${id}`;
}

// Un texto que no es UUID no puede existir en una columna uuid (y PostgreSQL fallaría al compararlo).
export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && isUUID(valor);
}

// Cabecera Idempotency-Key del contrato: obligatoria y con formato UUID.
export function validarIdempotencyKey(valor: string | undefined): string {
  const clave = valor?.trim();
  if (!clave) {
    throw new ConsultaInvalidaException([{ name: 'Idempotency-Key', reason: 'La cabecera Idempotency-Key es obligatoria' }]);
  }
  if (!esUuid(clave)) {
    throw new ConsultaInvalidaException([{ name: 'Idempotency-Key', reason: 'La cabecera Idempotency-Key debe ser un UUID' }]);
  }
  return clave.toLowerCase();
}

// Precio de una orden: el precio por habitación de toda la estancia (mismo criterio de /availability)
// multiplicado por las habitaciones pedidas. Con 1 habitación es exactamente ese precio.
export function precioOrden(totalPorHabitacion: number, habitaciones: number): number {
  return Math.round(totalPorHabitacion * habitaciones * 100) / 100;
}

// ───────────────────────── product_id ─────────────────────────
// El product_id del contrato es un texto que define cada sistema: aquí representa una oferta concreta,
// o sea habitación + fechas, con el formato  <uuid-de-la-habitación>:<checkin>:<checkout>
// (fechas YYYY-MM-DD). Es el único lugar donde se construye y se interpreta.

export interface ProductId {
  habitacionId: string;
  checkin: string;
  checkout: string;
}

export function construirProductId(habitacionId: string, checkin: string, checkout: string): string {
  return `${habitacionId}:${checkin}:${checkout}`;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
export const esFechaValida = (fecha: string) => {
  if (!FECHA_ISO.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  // Una fecha imposible (mes 13, día 45) da Invalid Date; 2026-02-30 se desplaza y ya no coincide
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(fecha);
};

// Interpretación estricta: tres partes, UUID válido, fechas reales y checkout posterior a checkin.
export function interpretarProductId(valor: unknown): ProductId {
  const error = (reason: string) =>
    new ConsultaInvalidaException([
      { name: 'product_id', reason: `${reason}. El product_id debe obtenerse de /availability (formato <uuid-habitacion>:<checkin>:<checkout>)` },
    ]);
  if (typeof valor !== 'string') throw error('product_id debe ser un texto');
  const partes = valor.split(':');
  if (partes.length !== 3) throw error('product_id no tiene el formato esperado de tres partes');
  const [habitacionId, checkin, checkout] = partes;
  if (!esUuid(habitacionId)) throw error('La primera parte de product_id no es un UUID válido');
  if (!esFechaValida(checkin) || !esFechaValida(checkout)) throw error('Las fechas de product_id deben ser YYYY-MM-DD válidas');
  if (checkout <= checkin) throw error('El checkout de product_id debe ser posterior al checkin');
  return { habitacionId: habitacionId.toLowerCase(), checkin, checkout };
}

// Huella del cuerpo: SHA-256 de su JSON con las claves ordenadas, así el orden de los campos no importa.
export function huellaDePeticion(cuerpo: unknown): string {
  const ordenar = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.map(ordenar);
    if (valor && typeof valor === 'object') {
      return Object.fromEntries(
        Object.keys(valor as object)
          .sort()
          .map((clave) => [clave, ordenar((valor as Record<string, unknown>)[clave])]),
      );
    }
    return valor;
  };
  return createHash('sha256').update(JSON.stringify(ordenar(cuerpo))).digest('hex');
}
