import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { ConsoleLogger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// Registro (logs) de la v2 sin datos personales ni secretos (contrato §7.1: "no registrar campos x-pii ni x-secret").
// Reglas:
//   * Se registra por qué pasó algo (método, ruta con plantilla, estado, duración, X-Correlation-ID, tipo de credencial),
//     nunca el cuerpo, la consulta ni las cabeceras de la petición.
//   * Si hay que volcar un objeto, pasa antes por redactar(): los campos sensibles salen como [REDACTADO].
//   * Los errores inesperados se resumen (tipo, código y pila): su mensaje puede traer valores de la fila que falló.
// La lista CAMPOS_SENSIBLES contiene todos los campos con x-pii / x-secret del contrato (registro-v2.spec.ts lo comprueba).

export const CAMPOS_PII = [
  'nombre',
  'apellido',
  'nombreCompleto',
  'full_name',
  'identificacion',
  'titularIdentificacion',
  'document_id',
  'email',
  'correo',
  'telefono',
  'phone',
  'edad',
  'nacionalidad',
  'huespedTitular',
  'ocupantes',
  'huesped',
  'direccionFacturacion',
  'contacto_comercial',
] as const;

export const CAMPOS_SECRETOS = ['claveAccesoDigital', 'password', 'contrasena', 'token', 'accessToken', 'authorization', 'x-api-key', 'cookie', 'secret', 'clave'] as const;

const SENSIBLES = new Set<string>([...CAMPOS_PII, ...CAMPOS_SECRETOS].map((c) => c.toLowerCase()));

export const REDACTADO = '[REDACTADO]';

export function esCampoSensible(nombre: string): boolean {
  return SENSIBLES.has(nombre.toLowerCase());
}

// Copia profunda con los campos sensibles reemplazados. No modifica el original.
export function redactar(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 8 || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((v) => redactar(v, profundidad + 1));
  return Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, esCampoSensible(k) ? REDACTADO : redactar(v, profundidad + 1)]));
}

// Resumen de un error sin su mensaje: tipo, código (p. ej. el de PostgreSQL) y primeras líneas de la pila.
export function resumenError(error: unknown): { tipo: string; codigo?: string; pila: string[] } {
  const e = error as { name?: string; code?: unknown; stack?: string } | null;
  const pila = (e?.stack ?? '')
    .split('\n')
    .filter((l) => l.trim().startsWith('at '))
    .slice(0, 6)
    .map((l) => l.trim());
  return { tipo: typeof e?.name === 'string' ? e.name : typeof error, ...(typeof e?.code === 'string' && { codigo: e.code }), pila };
}

export type NivelLog = 'info' | 'warn' | 'error';

export interface ContextoCorrelacion {
  correlationId: string;
  modulo?: string;
}

export const contextoCorrelacion = new AsyncLocalStorage<ContextoCorrelacion>();

export function correlacionActual(): string | undefined {
  return contextoCorrelacion.getStore()?.correlationId;
}

const PATRON_CORRELACION_LOG = /^[A-Za-z0-9._:-]{4,64}$/;

// Una línea JSON por evento en la salida estándar (la recogen Docker y Render). Siempre lleva correlationId.
export function registrarV2(nivel: NivelLog, evento: string, datos: Record<string, unknown> = {}): void {
  const ctx = contextoCorrelacion.getStore();
  const correlationId = (typeof datos.correlationId === 'string' && datos.correlationId) ? datos.correlationId : (ctx?.correlationId ?? randomUUID());
  const enriquecidos = {
    ...(ctx?.modulo && datos.modulo === undefined ? { modulo: ctx.modulo } : {}),
    ...datos,
    correlationId,
  };
  const linea = JSON.stringify({ ts: new Date().toISOString(), nivel, evento, ...(redactar(enriquecidos) as Record<string, unknown>) });
  (nivel === 'error' ? process.stderr : process.stdout).write(`${linea}\n`);
}

type PeticionRegistrada = Request & { correlationId?: string; principalV2?: { rol: string; via: string; usuarioId?: string } };

// Fase 9.2: asigna o propaga X-Correlation-ID en toda petición (v1, v2, /health) y lo fija en el contexto asíncrono
// para que cualquier log o llamada interna a otro microservicio lleve el mismo correlationId.
export function middlewareCorrelacion(modulo?: string) {
  const activo = process.env.V2_LOG_PETICIONES?.trim().toLowerCase() !== 'false';
  return (req: PeticionRegistrada, res: Response, next: NextFunction) => {
    const entrante = req.header('x-correlation-id');
    const correlacion = entrante && PATRON_CORRELACION_LOG.test(entrante) ? entrante : (req.correlationId ?? randomUUID());
    req.correlationId = correlacion;
    res.setHeader('X-Correlation-ID', correlacion);
    const inicio = process.hrtime.bigint();
    contextoCorrelacion.run({ correlationId: correlacion, modulo }, () => {
      if (activo && !req.originalUrl.startsWith('/api/v2')) {
        res.on('finish', () => {
          const ruta = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : req.originalUrl.split('?')[0];
          registrarV2('info', 'http', {
            ...(modulo ? { modulo } : {}),
            metodo: req.method,
            ruta,
            estado: res.statusCode,
            ms: Math.round(Number(process.hrtime.bigint() - inicio) / 1e5) / 10,
            correlationId: req.correlationId ?? correlacion,
          });
        });
      }
      next();
    });
  };
}

// Logger de Nest que antepone el correlationId de la petición actual (o uno nuevo si se registra fuera de petición).
export class LoggerConCorrelacion extends ConsoleLogger {
  protected formatContext(context: string): string {
    const cid = correlacionActual() ?? randomUUID();
    const base = context ? `${context} · cid=${cid}` : `cid=${cid}`;
    return super.formatContext(base);
  }
}

// Una línea por petición /api/v2 al terminar. V2_LOG_PETICIONES=false la apaga.
export function middlewareRegistroV2() {
  const activo = process.env.V2_LOG_PETICIONES?.trim().toLowerCase() !== 'false';
  return (req: PeticionRegistrada, res: Response, next: NextFunction) => {
    if (!activo) return next();
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      // La plantilla de la ruta (/orders/:orderId), no la URL: la URL real lleva identificadores y la consulta
      const ruta = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : '(sin ruta)';
      registrarV2('info', 'http', {
        metodo: req.method,
        ruta,
        estado: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - inicio) / 1e5) / 10,
        correlationId: req.correlationId ?? correlacionActual() ?? randomUUID(),
        credencial: req.principalV2?.via ?? 'ninguna',
        rol: req.principalV2?.rol,
      });
    });
    next();
  };
}

// Acceso a datos personales de otra persona: queda auditado con el X-Correlation-ID (contrato §7.1)
export function auditarAccesoPii(req: PeticionRegistrada, operacion: string, objeto?: string): void {
  const principal = req.principalV2;
  if (!principal || principal.rol === 'CLIENTE') return;
  registrarV2('info', 'acceso_pii', { operacion, objeto, correlationId: req.correlationId ?? correlacionActual() ?? randomUUID(), credencial: principal.via, rol: principal.rol, sujeto: principal.usuarioId });
}
