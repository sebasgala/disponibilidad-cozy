import { createHash } from 'crypto';

// Piezas puras del aviso de stock a Booking (sin red ni base de datos, para probarlas aparte).
//
// Contrato gRPC (inventory.proto, InventoryStockService.PushStockUpdate), una llamada por noche de estancia:
//   service_id       "alojamientos" (BOOKING_SERVICE_ID)
//   item_id          "<alojamiento.codigo>:<habitacion.codigo>"      ej. HTL-COZY-UIO-001:SUITE_DELUXE
//   date             la noche, YYYY-MM-DD
//   time_slot        hora de check-in del alojamiento, "14:00"
//   available_units  stock ABSOLUTO de esa noche en el momento del envío (no un delta)
//   timestamp        epoch en milisegundos; Booking descarta lo anterior al último que procesó (monótono)
//   slot_id          "slot-YYYYMMDD-HHMM" (campo 7 de inventory.proto)

export interface MensajeStock {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  timestamp: number;
  slot_id: string;
}

export interface EstadoNoche {
  fecha: string; // YYYY-MM-DD
  cupos: number;
  habitacionActiva: boolean;
  alojamientoActivo: boolean;
  habitacionCodigo: string;
  alojamientoCodigo: string;
  checkInDesde: string; // HH:MM
}

export const slotId = (fecha: string, hora: string): string => `slot-${fecha.replace(/-/g, '')}-${hora.replace(':', '')}`;

// Stock que ve Booking: una habitación dada de baja (o de un alojamiento dado de baja) no se vende, así que 0
export const unidadesDisponibles = (n: Pick<EstadoNoche, 'cupos' | 'habitacionActiva' | 'alojamientoActivo'>): number =>
  n.habitacionActiva && n.alojamientoActivo ? Math.max(0, n.cupos) : 0;

export function construirMensaje(n: EstadoNoche, serviceId: string, timestamp: number): MensajeStock {
  return {
    service_id: serviceId,
    item_id: `${n.alojamientoCodigo}:${n.habitacionCodigo}`,
    date: n.fecha,
    time_slot: n.checkInDesde,
    available_units: unidadesDisponibles(n),
    timestamp,
    slot_id: slotId(n.fecha, n.checkInDesde),
  };
}

// Espera antes del reintento número `intentos` (1 = primer fallo): base, 2·base, 4·base… con tope
export const esperaReintento = (intentos: number, baseMs: number, maxMs: number): number => Math.min(maxMs, baseMs * 2 ** Math.max(0, intentos - 1));

// Timestamps estrictamente crecientes dentro del proceso, aunque dos envíos caigan en el mismo milisegundo
export class RelojMonotono {
  private ultimo = 0;
  siguiente(ahoraMs: number): number {
    this.ultimo = Math.max(ahoraMs, this.ultimo + 1);
    return this.ultimo;
  }
}

export interface AckStock {
  success: boolean;
  message?: string;
  error_code?: string;
  current_available?: number;
}

export type ResultadoAck = 'ENVIADO' | 'RECHAZADO' | 'REINTENTAR';

// Qué hacer con la respuesta de Booking:
//   success                      => ENVIADO
//   STALE_TIMESTAMP_IGNORED      => ENVIADO (Booking ya tiene algo más nuevo; no es un error)
//   ITEM_NOT_FOUND, INVALID_SLOT => RECHAZADO (reintentar no cambia nada; lo corrige la conciliación con /inventario)
//   cualquier otro fallo         => REINTENTAR
export function clasificarAck(ack: AckStock): ResultadoAck {
  if (ack.success || ack.error_code === 'STALE_TIMESTAMP_IGNORED') return 'ENVIADO';
  if (ack.error_code === 'ITEM_NOT_FOUND' || ack.error_code === 'INVALID_SLOT') return 'RECHAZADO';
  return 'REINTENTAR';
}

export interface NocheInventario {
  fecha: string;
  tipoHabitacionCodigo: string;
  disponibles: number;
}

// Huella de la conciliación (GET /{id}/inventario): SHA-256 en hexadecimal de las líneas
// "YYYY-MM-DD:CODIGO:disponibles", una por noche y tipo de habitación, ordenadas por fecha y luego por código,
// unidas con "\n". Booking la compara con la suya para saber si necesita corregir.
export function hashInventario(noches: NocheInventario[]): string {
  const lineas = [...noches]
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.tipoHabitacionCodigo < b.tipoHabitacionCodigo ? -1 : a.tipoHabitacionCodigo > b.tipoHabitacionCodigo ? 1 : 0))
    .map((n) => `${n.fecha}:${n.tipoHabitacionCodigo}:${n.disponibles}`);
  return createHash('sha256').update(lineas.join('\n')).digest('hex');
}
