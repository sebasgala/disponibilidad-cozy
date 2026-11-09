import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDefined, IsIn, IsInt, IsOptional, IsString, Matches, Min, ValidateNested } from 'class-validator';
import { AccommodationsGuestsDto } from './accommodations-guests.dto';
import { BookerDto } from './booker.dto';
import { IsFechaIso } from '../../comun/dto/decorators/is-fecha-iso.decorator';

// Esquema `AvailabilityRequest` del contrato.
export class AvailabilityRequestDto {
  @ApiProperty({ type: 'integer', description: 'Id (entero) del alojamiento', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  accommodation: number;

  @ApiProperty({ type: () => BookerDto })
  @IsDefined({ message: 'booker es obligatorio' })
  @ValidateNested()
  @Type(() => BookerDto)
  booker: BookerDto;

  @ApiProperty({ description: 'Fecha de entrada (YYYY-MM-DD)', format: 'date', example: '2026-10-09' })
  @IsFechaIso()
  checkin: string;

  @ApiProperty({ description: 'Fecha de salida (YYYY-MM-DD). Debe ser posterior a checkin', format: 'date', example: '2026-10-12' })
  @IsFechaIso()
  checkout: string;

  @ApiProperty({ type: () => AccommodationsGuestsDto })
  @IsDefined({ message: 'guests es obligatorio' })
  @ValidateNested()
  @Type(() => AccommodationsGuestsDto)
  guests: AccommodationsGuestsDto;

  @ApiPropertyOptional({ description: 'Moneda ISO 4217 en mayúsculas', example: 'USD', pattern: '^[A-Z]{3}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO de 3 letras mayúsculas (ej. "USD")' })
  currency?: string;

  @ApiPropertyOptional({ type: [String], enum: ['extra_charges', 'include_bundle_variants'], example: [] })
  @IsOptional()
  @IsArray()
  @IsIn(['extra_charges', 'include_bundle_variants'], { each: true })
  extras?: string[];
}

export class NightPriceDto {
  @ApiProperty({ format: 'date', example: '2026-10-09' })
  date: string;

  @ApiProperty({ description: 'Precio de esa noche (tabla disponibilidad_diaria)', example: 109.25 })
  price: number;
}

export class ProductPriceDto {
  @ApiProperty({ description: 'Moneda del alojamiento', example: 'USD' })
  currency: string;

  @ApiProperty({ description: 'Suma de las noches, por habitación', example: 313.5 })
  total: number;

  @ApiProperty({ type: () => [NightPriceDto] })
  nights: NightPriceDto[];
}

// Elemento de `products`: el contrato lo deja como objeto libre; este es el formato que usamos.
export class AvailabilityProductDto {
  @ApiProperty({
    description:
      'Oferta concreta (habitación + fechas de la solicitud): `<uuid-de-la-habitación>:<checkin>:<checkout>`, fechas YYYY-MM-DD. ' +
      'Se envía tal cual a /orders/preview.',
    example: 'e2a1c6a0-2a4e-4b8e-9d57-0d6a3a3f5b10:2026-10-09:2026-10-12',
  })
  product_id: string;

  @ApiProperty({ example: 'Suite Junior' })
  name: string;

  @ApiProperty({ example: 'suite' })
  type: string;

  @ApiProperty({ example: 'breakfast_included', nullable: true })
  meal_plan: string | null;

  @ApiProperty({ example: 'free_cancellation', nullable: true })
  cancellation_type: string | null;

  @ApiProperty({ type: 'integer', example: 2 })
  max_adults: number;

  @ApiProperty({ type: 'integer', example: 2 })
  max_children: number;

  @ApiProperty({ type: 'integer', description: 'Habitaciones libres: el mínimo de cupos de todas las noches', example: 4 })
  rooms_left: number;

  @ApiProperty({ type: () => ProductPriceDto })
  price: ProductPriceDto;
}

export class AvailabilityDataDto {
  @ApiProperty({ type: 'integer', description: 'Id (entero) del alojamiento', example: 1 })
  id: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ type: () => [AvailabilityProductDto], description: 'Habitaciones disponibles para las fechas y huéspedes (vacío si no hay)' })
  products: AvailabilityProductDto[];

  @ApiProperty({ example: '/api/v1/alojamientos/1' })
  url: string;
}

// Esquema `AvailabilityResponse` del contrato.
export class AvailabilityResponseDto {
  @ApiProperty({ example: '3f6c1f0e-8f0a-4c35-9b5d-2f6f1b6a9c11' })
  request_id: string;

  @ApiProperty({ type: () => AvailabilityDataDto })
  data: AvailabilityDataDto;
}
