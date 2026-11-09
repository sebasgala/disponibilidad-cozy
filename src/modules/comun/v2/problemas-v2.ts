import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { registrarV2, resumenError } from './registro-v2';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

// Errores de la v2 (contrato alojamientos-openapi-v2): application/problem+json con `code` del enum cerrado ErrorCode.
// Es aparte del ProblemDetailsFilter de la v1 para no cambiar sus respuestas.

export type CodigoErrorV2 =
  | 'VALIDATION_FAILED'
  | 'INVALID_DOCUMENT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OUT_OF_STOCK'
  | 'QUOTE_EXPIRED'
  | 'PRICE_MISMATCH'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'INVALID_STATE_TRANSITION'
  | 'CHECKIN_TIME_NOT_REACHED'
  | 'CAPACITY_EXCEEDED'
  | 'DISCOUNT_EXCEEDS_CONTRACT'
  | 'PROMOTIONS_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'PROVIDER_DISABLED'
  | 'GATEWAY_TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'RESTRICTION_VIOLATED'
  | 'UNSUPPORTED_CURRENCY'
  | 'INSUFFICIENT_SCOPE';

export interface ParametroInvalido {
  name: string;
  reason: string;
}

// Campos opcionales del ProblemDetails del contrato que algunos errores agregan.
export interface ExtrasProblema {
  invalid_params?: ParametroInvalido[];
  retry_after_seconds?: number;
  habilitadoDesde?: string;
  restriccion?: string;
  scopes_requeridos?: string[];
}

export class ProblemaV2Exception extends HttpException {
  // Cabeceras extra de la respuesta de error (p. ej. Idempotent-Replayed al repetir un error guardado)
  readonly cabeceras: Record<string, string> = {};

  constructor(
    readonly estado: number,
    readonly codigo: CodigoErrorV2,
    readonly detalle: string,
    readonly extras: ExtrasProblema = {},
  ) {
    super(detalle, estado);
  }
}

// 400: la petición viola el esquema (campo ausente, tipo incorrecto, campo desconocido en el cuerpo)
export const peticionInvalida = (parametros: ParametroInvalido[], detalle = 'La petición no cumple el esquema del contrato.') =>
  new ProblemaV2Exception(400, 'VALIDATION_FAILED', detalle, { invalid_params: parametros });

// 422: la petición está bien formada pero viola una regla de negocio
export const reglaDeNegocio = (codigo: CodigoErrorV2, detalle: string, parametros: ParametroInvalido[] = [], extras: ExtrasProblema = {}) =>
  new ProblemaV2Exception(422, codigo, detalle, { ...extras, ...(parametros.length > 0 && { invalid_params: parametros }) });

export const noEncontrado = (detalle: string) => new ProblemaV2Exception(404, 'NOT_FOUND', detalle);

const TITULOS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const CODIGO_POR_ESTADO: Record<number, CodigoErrorV2> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'PROVIDER_DISABLED',
  504: 'GATEWAY_TIMEOUT',
};

export interface ProblemaV2 extends ExtrasProblema {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: CodigoErrorV2;
  correlation_id?: string;
  timestamp: string;
}

export function construirProblema(estado: number, codigo: CodigoErrorV2, detalle: string, instancia: string, correlacion?: string, extras: ExtrasProblema = {}): ProblemaV2 {
  return {
    type: `https://cozy.local/problems/${codigo.toLowerCase().replace(/_/g, '-')}`,
    title: TITULOS[estado] ?? 'Error',
    status: estado,
    detail: detalle,
    instance: instancia.slice(0, 300),
    code: codigo,
    ...(correlacion && { correlation_id: correlacion }),
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

// Escribe el problema en la respuesta con su cabecera Retry-After cuando corresponde.
export function responderProblema(res: Response, problema: ProblemaV2, cabeceras: Record<string, string> = {}): void {
  if (problema.retry_after_seconds !== undefined) res.setHeader('Retry-After', String(problema.retry_after_seconds));
  // 401: el contrato declara WWW-Authenticate
  if (problema.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="alojamientos"');
  for (const [nombre, valor] of Object.entries(cabeceras)) res.setHeader(nombre, valor);
  res.status(problema.status).type('application/problem+json').json(problema);
}

// Todo error de una ruta v2 sale con este formato. Los errores inesperados responden 500 sin revelar el motivo
// (el detalle va al log del servidor).
@Catch()
export class ProblemaV2Filter implements ExceptionFilter {
  catch(excepcion: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { correlationId?: string }>();
    const res = ctx.getResponse<Response>();
    const instancia = req.originalUrl.split('?')[0];

    let problema: ProblemaV2;
    let cabeceras: Record<string, string> = {};
    if (excepcion instanceof ProblemaV2Exception) {
      cabeceras = excepcion.cabeceras;
      problema = construirProblema(excepcion.estado, excepcion.codigo, excepcion.detalle, instancia, req.correlationId, excepcion.extras);
    } else if (excepcion instanceof HttpException) {
      const estado = excepcion.getStatus();
      const cuerpo = excepcion.getResponse();
      const mensaje = typeof cuerpo === 'string' ? cuerpo : ((cuerpo as { message?: string | string[] }).message ?? excepcion.message);
      const detalle = Array.isArray(mensaje) ? mensaje.join('; ') : mensaje;
      problema = construirProblema(estado, CODIGO_POR_ESTADO[estado] ?? (estado >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'), detalle, instancia, req.correlationId);
    } else {
      registrarV2('error', 'error_inesperado', { correlationId: req.correlationId, ruta: instancia, ...resumenError(excepcion) });
      problema = construirProblema(500, 'INTERNAL_ERROR', 'El servidor tuvo un problema inesperado.', instancia, req.correlationId);
    }
    responderProblema(res, problema, cabeceras);
  }
}

// Filtro global para lo que ocurre antes de llegar a un controlador (cuerpo JSON mal formado, ruta que no existe):
// dentro de /api/v2 responde con el formato del contrato; fuera de ahí se comporta como siempre (v1 sin cambios).
@Catch(HttpException)
export class RutasV2Filter extends BaseExceptionFilter {
  private readonly v2 = new ProblemaV2Filter();

  catch(excepcion: HttpException, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    if (req.originalUrl === '/api/v2' || req.originalUrl.startsWith('/api/v2/') || req.originalUrl.startsWith('/api/v2?')) {
      this.v2.catch(excepcion, host);
      return;
    }
    super.catch(excepcion, host);
  }
}
