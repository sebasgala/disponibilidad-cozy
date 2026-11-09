import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

type Entorno = Record<string, string | undefined>;

const ORIGEN_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const ORIGEN_DE_DESARROLLO = 'http://localhost:5173'; // Vite

// Un origen es esquema + host + puerto, sin barra final ni ruta.
const normalizar = (origen: string) => origen.trim().replace(/\/+$/, '');

// Orígenes permitidos según CORS_ORIGIN (una o varias URLs separadas por comas).
// - Con CORS_ORIGIN: exactamente esa lista (y, fuera de producción, http://localhost:5173).
// - Sin CORS_ORIGIN: ningún origen salvo localhost / 127.0.0.1.
export function origenesPermitidos(env: Entorno = process.env): { lista: string[]; soloLocalhost: boolean } {
  const lista = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map(normalizar)
    .filter(Boolean);
  if (lista.includes('*')) {
    throw new Error('CORS_ORIGIN no puede ser "*": lista las URLs permitidas separadas por comas.');
  }
  if (lista.length === 0) return { lista: [], soloLocalhost: true };
  if (env.NODE_ENV !== 'production' && !lista.includes(ORIGEN_DE_DESARROLLO)) lista.push(ORIGEN_DE_DESARROLLO);
  return { lista, soloLocalhost: false };
}

export function esOrigenPermitido(origen: string, env: Entorno = process.env): boolean {
  const { lista, soloLocalhost } = origenesPermitidos(env);
  return soloLocalhost ? ORIGEN_LOCAL.test(origen) : lista.includes(normalizar(origen));
}

export function opcionesCors(env: Entorno = process.env): CorsOptions {
  origenesPermitidos(env); // falla al arrancar si CORS_ORIGIN es inválido
  return {
    // Sin cabecera Origin (curl, servidor a servidor) no hay nada que comprobar. Un origen no permitido recibe la
    // respuesta sin cabeceras CORS y el navegador la bloquea.
    origin: (origen, devolver) => devolver(null, !origen || esOrigenPermitido(origen, env)),
    // PUT: reemplazo completo de un alojamiento (PUT /admin/alojamientos/{id}).
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // X-Device-Fingerprint es obligatoria en POST /search (contrato) y el frontend la envía desde el navegador.
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Device-Fingerprint', 'X-Correlation-ID', 'If-None-Match', 'X-Node-Id'],
    // Cabeceras que el navegador puede leer. Retry-After llega con el 429 del límite de intentos.
    exposedHeaders: ['Retry-After', 'ETag', 'X-Correlation-ID', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Location', 'Idempotent-Replayed'],
    maxAge: 600,
  };
}

// TRUST_PROXY para Express (`app.set('trust proxy', ...)`): "true", "false", un número de saltos ("1" detrás de
// Render) o una lista de IP/subredes. Por defecto no se confía en ningún proxy.
export function valorTrustProxy(env: Entorno = process.env): boolean | number | string {
  const crudo = (env.TRUST_PROXY ?? '').trim();
  if (crudo === '' || crudo.toLowerCase() === 'false') return false;
  if (crudo.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(crudo)) return Number(crudo);
  return crudo;
}
