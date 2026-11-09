import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { construirProblema, responderProblema } from './problemas-v2';
import { contextoCorrelacion } from './registro-v2';

// Reglas transversales del contrato v2 (§1): X-Correlation-ID en toda respuesta y cabeceras RateLimit-*.
// Se registra una vez, antes de las rutas, con app.use('/api/v2', middlewareV2()).

// X-Correlation-ID del contrato: 4 a 64 caracteres
const PATRON_CORRELACION = /^[A-Za-z0-9._:-]{4,64}$/;
const VENTANA_MS = 60_000;

export interface OpcionesMiddlewareV2 {
  limitePorMinuto?: number;
}

export function middlewareV2({ limitePorMinuto }: OpcionesMiddlewareV2 = {}) {
  // V2_LIMITE_POR_MINUTO sube o baja el tope de peticiones por IP (por defecto 600)
  const limite = limitePorMinuto ?? (Number(process.env.V2_LIMITE_POR_MINUTO) || 600);
  const ventanas = new Map<string, { inicio: number; cuenta: number }>();
  setInterval(() => {
    const ahora = Date.now();
    for (const [ip, v] of ventanas) if (ahora - v.inicio >= VENTANA_MS) ventanas.delete(ip);
  }, VENTANA_MS).unref();

  return (req: Request & { correlationId?: string }, res: Response, next: NextFunction) => {
    const entrante = req.header('x-correlation-id');
    const valida = entrante === undefined || PATRON_CORRELACION.test(entrante);
    const correlacion = valida ? (entrante ?? randomUUID()) : randomUUID();
    req.correlationId = correlacion;
    res.setHeader('X-Correlation-ID', correlacion);

    if (!valida) {
      responderProblema(
        res,
        construirProblema(400, 'VALIDATION_FAILED', 'La cabecera X-Correlation-ID no cumple el formato del contrato.', req.originalUrl.split('?')[0], correlacion, {
          invalid_params: [{ name: 'X-Correlation-ID', reason: 'debe tener entre 4 y 64 caracteres de A-Z, a-z, 0-9, punto, guion, guion bajo o dos puntos' }],
        }),
      );
      return;
    }

    const ahora = Date.now();
    const clave = req.ip ?? 'desconocida';
    let ventana = ventanas.get(clave);
    if (!ventana || ahora - ventana.inicio >= VENTANA_MS) {
      ventana = { inicio: ahora, cuenta: 0 };
      ventanas.set(clave, ventana);
    }
    ventana.cuenta++;
    const reinicio = Math.max(1, Math.ceil((ventana.inicio + VENTANA_MS - ahora) / 1000));
    res.setHeader('RateLimit-Limit', String(limite));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limite - ventana.cuenta)));
    res.setHeader('RateLimit-Reset', String(reinicio));

    if (ventana.cuenta > limite) {
      responderProblema(
        res,
        construirProblema(429, 'RATE_LIMITED', 'Superaste el límite de peticiones. Espera antes de reintentar.', req.originalUrl.split('?')[0], correlacion, {
          retry_after_seconds: reinicio,
        }),
      );
      return;
    }
    const actual = contextoCorrelacion.getStore();
    if (actual) {
      actual.correlationId = correlacion;
      next();
    } else {
      contextoCorrelacion.run({ correlationId: correlacion }, () => next());
    }
  };
}

// Transporte seguro (contrato §7.1). Con la petición ya por HTTPS (directo o detrás de un proxy en confianza, ver
// TRUST_PROXY) añade Strict-Transport-Security. Con V2_EXIGIR_HTTPS=true rechaza las peticiones que llegaron sin cifrar.
export function middlewareHttpsV2() {
  const exigir = process.env.V2_EXIGIR_HTTPS?.trim().toLowerCase() === 'true';
  return (req: Request & { correlationId?: string }, res: Response, next: NextFunction) => {
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    } else if (exigir) {
      responderProblema(
        res,
        construirProblema(403, 'FORBIDDEN', 'Esta API solo se atiende por HTTPS (TLS 1.2 o superior).', req.originalUrl.split('?')[0], req.correlationId ?? randomUUID()),
      );
      return;
    }
    next();
  };
}
