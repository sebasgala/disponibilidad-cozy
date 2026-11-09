import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { CodigoProblema, InvalidParam } from './problem-details.exceptions';

// Índice único de reservas (UQ_ORDENES_PREVIEW en orden.entity.ts): como los CHECK de abajo, se reconoce por su nombre
// y así lo transversal no importa entidades de un dominio.
const UQ_ORDENES_PREVIEW = 'UQ_ordenes_previewId';

// Campo afectado por cada CHECK, para armar invalidParams con un nombre que el cliente entienda.
const CAMPO_DE_CHECK: Record<string, InvalidParam> = {
  CHK_disponibilidad_cupos: { name: 'cupos', reason: 'no puede ser negativo' },
  CHK_disponibilidad_precio: { name: 'precio', reason: 'no puede ser negativo' },
  CHK_disponibilidad_cupos_totales: { name: 'cuposTotales', reason: 'no puede ser negativo' },
  CHK_disponibilidad_cupos_maximo: { name: 'cuposTotales', reason: 'no puede ser menor que las habitaciones ya vendidas' },
  CHK_habitaciones_precio_base: { name: 'precioBase', reason: 'no puede ser negativo' },
  CHK_alojamientos_precio_por_noche: { name: 'precioPorNoche', reason: 'no puede ser negativo' },
  CHK_ordenes_total: { name: 'total_price', reason: 'no puede ser negativo' },
  CHK_ordenes_preview_total: { name: 'total_price', reason: 'no puede ser negativo' },
  CHK_ordenes_fechas: { name: 'checkout', reason: 'debe ser posterior a checkin' },
  CHK_ordenes_preview_fechas: { name: 'checkout', reason: 'debe ser posterior a checkin' },
  CHK_ordenes_habitaciones_reservadas: { name: 'number_of_rooms', reason: 'debe ser al menos 1' },
};

interface ErrorPostgres {
  code?: string;
  constraint?: string;
  column?: string;
  detail?: string;
}

interface Problema {
  status: number;
  title: string;
  detail: string;
  code: CodigoProblema;
  invalidParams?: InvalidParam[];
}

// Último resguardo: si una restricción de PostgreSQL rechaza un dato (porque el código no lo validó antes),
// la respuesta es 400 o 409 en application/problem+json, nunca un 500. Es global (APP_FILTER) y cubre
// también las rutas de administración. Cualquier otro error de base de datos sigue el manejo normal de Nest.
@Catch(QueryFailedError)
export class ErroresBaseDatosFilter extends BaseExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const problema = this.traducir(exception.driverError as ErrorPostgres);
    if (!problema) return super.catch(exception, host);

    const { status, title, detail, code, invalidParams } = problema;
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, detail, code, ...(invalidParams && { invalidParams }) });
  }

  private traducir(error: ErrorPostgres): Problema | null {
    switch (error?.code) {
      case '23514': // check_violation
        return {
          status: 400,
          title: 'Petición inválida',
          detail: 'Un valor no cumple las reglas del modelo de datos',
          code: 'VALIDATION_FAILED',
          invalidParams: [CAMPO_DE_CHECK[error.constraint] ?? { name: error.constraint ?? 'desconocido', reason: 'valor no permitido' }],
        };
      case '23502': // not_null_violation
        return {
          status: 400,
          title: 'Petición inválida',
          detail: 'Falta un dato obligatorio',
          code: 'VALIDATION_FAILED',
          invalidParams: [{ name: error.column ?? 'desconocido', reason: 'es obligatorio' }],
        };
      case '23503': // foreign_key_violation
        // "is not present": se apunta a algo que no existe (400). Si no, se intenta borrar algo que otro usa (409).
        return error.detail?.includes('is not present')
          ? { status: 400, title: 'Petición inválida', detail: 'Hace referencia a un registro que no existe', code: 'VALIDATION_FAILED' }
          : { status: 409, title: 'Conflicto', detail: 'El registro está en uso por otros datos y no se puede modificar ni borrar', code: 'VALIDATION_FAILED' };
      case '23505': // unique_violation
        return error.constraint === UQ_ORDENES_PREVIEW
          ? {
              status: 409,
              title: 'Conflicto',
              detail: 'La vista previa ya se usó para crear una orden: pide una nueva con /orders/preview',
              code: 'ROOM_NO_LONGER_AVAILABLE',
              invalidParams: [{ name: 'order_preview_id', reason: 'ya se usó para crear una orden' }],
            }
          : { status: 409, title: 'Conflicto', detail: 'Ya existe un registro con esos datos', code: 'VALIDATION_FAILED' };
      default:
        return null;
    }
  }
}
