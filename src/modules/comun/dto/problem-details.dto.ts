import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Esquemas ProblemDetails e invalidParams del contrato (solo para documentar en Swagger).
export class InvalidParamDto {
  @ApiProperty({ example: 'checkout' })
  name: string;

  @ApiProperty({ example: 'checkout debe ser posterior a checkin' })
  reason: string;
}

export class ProblemDetailsDto {
  @ApiProperty({ example: 'about:blank' })
  type: string;

  @ApiProperty({ example: 'Petición inválida' })
  title: string;

  @ApiProperty({ type: 'integer', example: 400 })
  status: number;

  @ApiPropertyOptional({ example: 'La petición contiene parámetros inválidos' })
  detail?: string;

  @ApiProperty({
    description: 'NOT_FOUND (404) llega en la versión 1.1.0 del contrato. UNAUTHORIZED, FORBIDDEN, ACCOUNT_PENDING y ACCOUNT_SUSPENDED son códigos internos de las rutas de seguridad y administración',
    example: 'VALIDATION_FAILED',
    enum: [
      'NOT_FOUND',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'ACCOUNT_PENDING',
      'ACCOUNT_SUSPENDED',
      'VALIDATION_FAILED',
      'ROOM_NO_LONGER_AVAILABLE',
      'PRICE_CHANGED',
      'BOOKING_NOT_CONFIRMED',
      'CANCELLATION_NOT_ALLOWED',
      'RATE_LIMIT_EXCEEDED',
      'PAYMENT_REFERENCE_INVALID',
      'PAYMENT_NOT_AUTHORIZED',
    ],
  })
  code: string;

  @ApiPropertyOptional({ type: () => [InvalidParamDto] })
  invalidParams?: InvalidParamDto[];
}
