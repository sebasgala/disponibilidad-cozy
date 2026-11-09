import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested, IsArray } from 'class-validator';
import { AccommodationsGuestsDto } from './accommodations-guests.dto';
import { BookerDto } from './booker.dto';
import { IsFechaIso } from '../../comun/dto/decorators/is-fecha-iso.decorator';

// Esquema `SearchAccommodationRequest` del contrato.
export class SearchAccommodationRequestDto {
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

  @ApiPropertyOptional({ type: 'integer', description: 'Id (entero) de la ciudad', example: 1 })
  @IsOptional()
  @IsInt()
  city?: number;

  @ApiPropertyOptional({ description: 'Código de país ISO de 2 letras minúsculas', example: 'ec', pattern: '^[a-z]{2}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'country debe ser un código ISO de 2 letras minúsculas (ej. "ec")' })
  country?: string;

  @ApiProperty({ type: () => AccommodationsGuestsDto })
  @IsDefined({ message: 'guests es obligatorio' })
  @ValidateNested()
  @Type(() => AccommodationsGuestsDto)
  guests: AccommodationsGuestsDto;

  @ApiPropertyOptional({ type: [String], enum: ['extra_charges', 'products'], example: [] })
  @IsOptional()
  @IsArray()
  @IsIn(['extra_charges', 'products'], { each: true })
  extras?: string[];

  @ApiPropertyOptional({ description: 'Moneda ISO 4217 en mayúsculas', example: 'USD', pattern: '^[A-Z]{3}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO de 3 letras mayúsculas (ej. "USD")' })
  currency?: string;

  @ApiPropertyOptional({ type: 'integer', description: 'Resultados por página', minimum: 10, maximum: 100, default: 100, example: 10 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  rows?: number = 100;

  @ApiPropertyOptional({ description: 'Token de página: usar el `next_page` de la respuesta anterior', type: String })
  @IsOptional()
  @IsString()
  page?: string;
}

export class SearchResultItemDto {
  @ApiProperty({ type: 'integer', description: 'Id (entero) del alojamiento', example: 1 })
  id: number;

  @ApiProperty({ description: 'Enlace al alojamiento', example: '/api/v1/alojamientos/1' })
  url: string;
}

// Esquema `SearchAccommodationResponse` del contrato.
export class SearchAccommodationResponseDto {
  @ApiProperty({ description: 'Identificador de esta petición', example: '3f6c1f0e-8f0a-4c35-9b5d-2f6f1b6a9c11' })
  request_id: string;

  @ApiProperty({ type: () => [SearchResultItemDto] })
  data: SearchResultItemDto[];

  @ApiProperty({ description: 'Token para pedir la página siguiente; null si no hay más', type: String, nullable: true, example: null })
  next_page: string | null;
}
