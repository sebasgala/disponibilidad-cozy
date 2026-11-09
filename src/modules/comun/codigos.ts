// Códigos públicos del contrato v2. Se generan una sola vez al crear la fila y nunca cambian (aunque cambie el
// nombre de la ciudad o de la habitación): Booking los guarda como llave de negocio.
//   alojamiento: HTL-<NODO>-<3 letras de la ciudad>-<id con al menos 3 dígitos>   ej. HTL-COZY-UIO-001
//   habitación:  el nombre en MAYÚSCULAS con guion bajo, único por alojamiento    ej. SUITE_DELUXE, SUITE_DELUXE_2
// La migración 1792000000000-ContratoV2Catalogo calcula los de las filas existentes con la misma regla.

export const TIPOS_PROPIEDAD = ['HOTEL', 'RESORT', 'APARTAMENTO', 'HOSTAL', 'HOSTERIA'] as const;
export type TipoPropiedad = (typeof TIPOS_PROPIEDAD)[number];

const sinAcentos = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Prefijo del nodo en los códigos. NODO_CODIGO lo cambia (A-Z, 0-9 y guion bajo, sin límite de largo; ej. NODE_ALO_COZY).
export function nodoCodigo(env: Record<string, string | undefined> = process.env): string {
  return (env.NODO_CODIGO ?? 'COZY').toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'COZY';
}

export function codigoAlojamiento(id: number, ciudad: string | null | undefined): string {
  const letras = sinAcentos(ciudad ?? '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  return `HTL-${nodoCodigo()}-${letras}-${String(id).padStart(3, '0')}`;
}

// Código de una habitación nueva a partir de su nombre; `existentes` son los códigos que ya tiene el alojamiento.
export function codigoHabitacion(nombre: string, existentes: Iterable<string>): string {
  const base = sinAcentos(nombre).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, 36).padEnd(2, 'X');
  const usados = new Set(existentes);
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidato = `${base}_${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}
