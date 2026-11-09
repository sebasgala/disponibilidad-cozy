import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export const DETAILS_EXTRAS = ['description', 'bundles', 'facilities', 'payment', 'photos', 'policies', 'rooms'] as const;

// Esquema `AccommodationDetailsRequest` del contrato (todos los campos son opcionales).
export class AccommodationDetailsRequestDto {
  @ApiPropertyOptional({ description: 'Ids (enteros) de los alojamientos. Si se envía, se ignoran city y country', type: 'integer', isArray: true, example: [1, 3] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  accommodations?: number[];

  @ApiPropertyOptional({ type: 'integer', description: 'Id (entero) de la ciudad', example: 1 })
  @IsOptional()
  @IsInt()
  city?: number;

  @ApiPropertyOptional({ description: 'Código de país', example: 'ec' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'Bloques a incluir. Si se omite se incluyen todos los que existen en nuestro modelo (bundles y payment no existen y se ignoran)',
    type: [String],
    enum: DETAILS_EXTRAS,
    example: ['description', 'photos', 'facilities', 'policies', 'rooms'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(DETAILS_EXTRAS, { each: true })
  extras?: string[];

  @ApiPropertyOptional({ description: 'Idiomas (no hay traducciones: se ignora)', type: [String], example: ['es'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];
}

export class DetailsRoomDto {
  @ApiProperty({ description: 'UUID de la habitación (texto). Aquí no hay fechas: para reservar usa el product_id de /availability', example: 'e2a1c6a0-2a4e-4b8e-9d57-0d6a3a3f5b10' })
  product_id: string;

  @ApiProperty({ example: 'Suite Junior' })
  name: string;

  @ApiProperty({ example: 'suite' })
  type: string;

  @ApiProperty({ type: 'integer', example: 2 })
  max_adults: number;

  @ApiProperty({ type: 'integer', example: 2 })
  max_children: number;

  @ApiProperty({ description: 'Precio base de catálogo (el precio real sale de /availability)', example: 95 })
  base_price: number;

  @ApiProperty({ example: 'breakfast_included', nullable: true })
  meal_plan: string | null;

  @ApiProperty({ example: 'free_cancellation', nullable: true })
  cancellation_type: string | null;
}

export class DetailsCityDto {
  @ApiProperty({ type: 'integer', example: 1 })
  id: number;

  @ApiProperty({ example: 'Quito' })
  name: string;

  @ApiProperty({ example: 'ec' })
  country: string;
}

// Elemento de `data`: el contrato lo deja como objeto libre; los bloques opcionales dependen de `extras`.
export class AccommodationDetailsItemDto {
  @ApiProperty({ type: 'integer', example: 1 })
  id: number;

  @ApiProperty({ example: 'Cozy Boutique Quito' })
  name: string;

  @ApiProperty({ type: () => DetailsCityDto, nullable: true })
  city: DetailsCityDto | null;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional({ example: 'Hotel boutique en el centro histórico.', nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  photos?: string[] | null;

  @ApiPropertyOptional({ type: [String], nullable: true, example: ['wifi', 'desayuno'] })
  facilities?: string[] | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, example: { checkin: '15:00', checkout: '12:00' } })
  policies?: Record<string, any> | null;

  @ApiPropertyOptional({ type: () => [DetailsRoomDto] })
  rooms?: DetailsRoomDto[];
}

// Esquema `AccommodationDetailsResponse` del contrato.
export class AccommodationDetailsResponseDto {
  @ApiProperty({ example: '3f6c1f0e-8f0a-4c35-9b5d-2f6f1b6a9c11' })
  request_id: string;

  @ApiProperty({ type: () => [AccommodationDetailsItemDto] })
  data: AccommodationDetailsItemDto[];

  @ApiProperty({ description: 'Siempre null: la petición no tiene parámetro de página', type: String, nullable: true, example: null })
  next_page: string | null;
}
