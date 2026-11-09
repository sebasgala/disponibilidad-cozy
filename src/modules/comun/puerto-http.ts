import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import {
  CodigoProblema,
  ConflictoException,
  ConsultaInvalidaException,
  InvalidParam,
  NoAutenticadoException,
  ProhibidoException,
  RecursoNoEncontradoException,
} from './problems/problem-details.exceptions';
import { CodigoErrorV2, ExtrasProblema, ProblemaV2Exception } from './v2/problemas-v2';
import { correlacionActual } from './v2/registro-v2';

interface ErrorPuertoSerializado {
  _tipo?: string;
  estado?: number;
  status?: number;
  codigo?: CodigoErrorV2;
  code?: CodigoProblema;
  detalle?: string;
  detail?: string;
  message?: string;
  extras?: ExtrasProblema;
  invalidParams?: InvalidParam[];
}

// Filtro para los controladores HTTP de puertos internos (/api/v1/interno/*, fase 9.2):
// conserva el tipo exacto de excepción (v1 ProblemDetails o v2 ProblemaV2Exception) para que el cliente HTTP del puerto
// la relance idéntica en el proceso llamador.
@Catch()
export class PuertoInternoFilter implements ExceptionFilter {
  catch(excepcion: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (excepcion instanceof ProblemaV2Exception) {
      res.status(excepcion.estado).json({
        _tipo: 'ProblemaV2Exception',
        estado: excepcion.estado,
        codigo: excepcion.codigo,
        detalle: excepcion.detalle,
        extras: excepcion.extras,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    if (excepcion instanceof RecursoNoEncontradoException) {
      res.status(404).json({
        _tipo: 'RecursoNoEncontradoException',
        detail: excepcion.message,
        invalidParams: excepcion.invalidParams,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    if (excepcion instanceof ConsultaInvalidaException) {
      res.status(400).json({
        _tipo: 'ConsultaInvalidaException',
        detail: excepcion.message,
        invalidParams: excepcion.invalidParams,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    if (excepcion instanceof ConflictoException) {
      res.status(409).json({
        _tipo: 'ConflictoException',
        code: excepcion.code,
        detail: excepcion.message,
        invalidParams: excepcion.invalidParams,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    if (excepcion instanceof ProhibidoException) {
      res.status(403).json({
        _tipo: 'ProhibidoException',
        code: excepcion.code,
        detail: excepcion.message,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    if (excepcion instanceof NoAutenticadoException) {
      res.status(401).json({
        _tipo: 'NoAutenticadoException',
        detail: excepcion.message,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    if (excepcion instanceof HttpException) {
      const status = excepcion.getStatus();
      res.status(status).json({
        _tipo: 'HttpException',
        status,
        message: excepcion.message,
      } satisfies ErrorPuertoSerializado);
      return;
    }
    res.status(500).json({
      _tipo: 'Error',
      message: (excepcion as Error)?.message ?? 'Error interno en llamada de puerto',
    } satisfies ErrorPuertoSerializado);
  }
}

function reconstruirErrorPuerto(status: number, cuerpo: ErrorPuertoSerializado | null): Error {
  if (cuerpo?._tipo === 'ProblemaV2Exception') {
    return new ProblemaV2Exception(
      cuerpo.estado ?? status,
      cuerpo.codigo ?? 'INTERNAL_ERROR',
      cuerpo.detalle ?? 'Error en servicio interno',
      cuerpo.extras ?? {},
    );
  }
  if (cuerpo?._tipo === 'RecursoNoEncontradoException') {
    return new RecursoNoEncontradoException(cuerpo.detail ?? 'Recurso no encontrado', cuerpo.invalidParams ?? []);
  }
  if (cuerpo?._tipo === 'ConsultaInvalidaException') {
    return new ConsultaInvalidaException(cuerpo.invalidParams ?? [], cuerpo.detail);
  }
  if (cuerpo?._tipo === 'ConflictoException') {
    return new ConflictoException(cuerpo.code ?? 'VALIDATION_FAILED', cuerpo.detail ?? 'Conflicto', cuerpo.invalidParams ?? []);
  }
  if (cuerpo?._tipo === 'ProhibidoException') {
    return new ProhibidoException(cuerpo.detail ?? 'Prohibido', cuerpo.code ?? 'FORBIDDEN');
  }
  if (cuerpo?._tipo === 'NoAutenticadoException') {
    return new NoAutenticadoException(cuerpo.detail);
  }
  if (cuerpo?._tipo === 'HttpException') {
    return new HttpException(cuerpo.message ?? 'Error HTTP', cuerpo.status ?? status);
  }
  return new Error(cuerpo?.message ?? cuerpo?.detalle ?? cuerpo?.detail ?? `Error HTTP ${status} en puerto interno`);
}

// Llamada HTTP interna entre procesos de dominio (D1 de fase 9.2): propaga X-Correlation-ID y reconstruye las excepciones.
export async function llamarPuertoHttp<T>(
  baseUrl: string,
  ruta: string,
  opciones: { metodo?: 'GET' | 'POST'; cuerpo?: unknown } = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
  const metodo = opciones.metodo ?? 'POST';
  const correlacion = correlacionActual();
  const cabeceras: Record<string, string> = {
    Accept: 'application/json',
    ...(correlacion ? { 'X-Correlation-ID': correlacion } : {}),
    ...(opciones.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  const respuesta = await fetch(url, {
    method: metodo,
    headers: cabeceras,
    ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    let parsed: ErrorPuertoSerializado | null = null;
    try {
      parsed = texto ? (JSON.parse(texto) as ErrorPuertoSerializado) : null;
    } catch {
      parsed = null;
    }
    throw reconstruirErrorPuerto(respuesta.status, parsed);
  }
  if (!texto || texto === 'null') return null as T;
  return JSON.parse(texto) as T;
}

