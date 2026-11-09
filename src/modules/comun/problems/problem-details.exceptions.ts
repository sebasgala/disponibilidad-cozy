import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

// Elemento de `invalidParams` del esquema ProblemDetails del contrato.
export interface InvalidParam {
  name: string;
  reason: string;
}

// Valores del enum `code` de ProblemDetails en el contrato. NOT_FOUND aún no está en el contrato 1.0.0:
// los autores lo confirmaron para la versión 1.1.0 (ver docs/pendientes-contrato-1.1.0.md).
export type CodigoProblema =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ACCOUNT_PENDING'
  | 'ACCOUNT_SUSPENDED'
  | 'VALIDATION_FAILED'
  | 'ROOM_NO_LONGER_AVAILABLE'
  | 'PRICE_CHANGED'
  | 'BOOKING_NOT_CONFIRMED'
  | 'CANCELLATION_NOT_ALLOWED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'PAYMENT_REFERENCE_INVALID'
  | 'PAYMENT_NOT_AUTHORIZED';

// 400 con la lista de parámetros inválidos ya armada (validaciones que no hace class-validator).
export class ConsultaInvalidaException extends BadRequestException {
  constructor(
    public readonly invalidParams: InvalidParam[],
    detail = 'La petición contiene parámetros inválidos',
  ) {
    super(detail);
  }
}

// 404 para un recurso que no existe (o un alojamiento inactivo), con code NOT_FOUND.
export class RecursoNoEncontradoException extends NotFoundException {
  public readonly code: CodigoProblema = 'NOT_FOUND';

  constructor(
    detail: string,
    public readonly invalidParams: InvalidParam[] = [],
  ) {
    super(detail);
  }
}

// 409 del contrato (ProblemDetails409): conflicto de negocio con su código.
export class ConflictoException extends ConflictException {
  constructor(
    public readonly code: CodigoProblema,
    detail: string,
    public readonly invalidParams: InvalidParam[] = [],
  ) {
    super(detail);
  }
}

// 401: sin token, token inválido o vencido, o credenciales incorrectas. Código interno (no está en el contrato).
export class NoAutenticadoException extends UnauthorizedException {
  public readonly code: CodigoProblema = 'UNAUTHORIZED';

  constructor(detail = 'Hace falta iniciar sesión con un token válido') {
    super(detail);
  }
}

// 403: rol insuficiente, cuenta pendiente de aprobación o cuenta suspendida. Códigos internos.
export class ProhibidoException extends ForbiddenException {
  constructor(
    detail: string,
    public readonly code: CodigoProblema = 'FORBIDDEN',
  ) {
    super(detail);
  }
}

// 429: demasiados intentos. RATE_LIMIT_EXCEEDED sí está en el contrato.
export class DemasiadosIntentosException extends HttpException {
  public readonly code: CodigoProblema = 'RATE_LIMIT_EXCEEDED';

  constructor(
    detail: string,
    public readonly retryAfterSegundos: number,
  ) {
    super(detail, 429);
  }
}

// 422: la Idempotency-Key ya se usó con otro cuerpo (el contrato no define este caso).
export class ClaveIdempotenciaReutilizadaException extends UnprocessableEntityException {
  constructor(public readonly invalidParams: InvalidParam[]) {
    super('La Idempotency-Key ya se usó con una petición distinta');
  }
}
