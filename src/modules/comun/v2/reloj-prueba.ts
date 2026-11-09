import { Request } from 'express';
import { Reloj } from './reloj';

// Cabeceras SOLO PARA PRUEBAS (V2_CABECERAS_PRUEBA=true y fuera de producción). Ignoradas siempre en producción.
//   X-Prueba-Retraso-Ms   mantiene la petición en curso (probar el 409 IDEMPOTENCY_IN_PROGRESS)
//   X-Prueba-Desfase-Ms   adelanta el reloj esa cantidad de milisegundos (QUOTE_EXPIRED)
//   X-Prueba-Ahora        fija el reloj en un instante exacto, ISO 8601 con zona (CHECKIN_TIME_NOT_REACHED a las 13:59:59 / 14:00:00)
//   X-Prueba-Token-Ahora  fija el instante con que se mide el VENCIMIENTO del token de Cozy (probar que vence a los 10 minutos
//                         sin esperarlos). Es otra cabecera a propósito: X-Prueba-Ahora mueve el reloj del negocio a fechas
//                         futuras y, si también midiera el token, lo daría por vencido.
export const pruebasHabilitadas = () => process.env.V2_CABECERAS_PRUEBA === 'true' && process.env.NODE_ENV !== 'production';

export const numeroDePrueba = (req: Request, cabecera: string): number => (pruebasHabilitadas() ? Math.max(0, Number(req.header(cabecera)) || 0) : 0);

const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

// Instante para medir el vencimiento del token, o undefined para usar el reloj real (siempre en producción)
export function ahoraDelTokenDePrueba(req: Request): Date | undefined {
  if (!pruebasHabilitadas()) return undefined;
  const fijada = req.header('x-prueba-token-ahora')?.trim();
  return fijada && ISO_CON_ZONA.test(fijada) && !Number.isNaN(Date.parse(fijada)) ? new Date(fijada) : undefined;
}

// La hora de la petición: la del reloj (inyectable en las pruebas unitarias) o la que fija la cabecera de pruebas
export function ahoraDe(reloj: Reloj, req: Request): Date {
  if (pruebasHabilitadas()) {
    const fijada = req.header('x-prueba-ahora')?.trim();
    if (fijada && ISO_CON_ZONA.test(fijada) && !Number.isNaN(Date.parse(fijada))) return new Date(fijada);
  }
  return new Date(reloj.ahora().getTime() + numeroDePrueba(req, 'x-prueba-desfase-ms'));
}
