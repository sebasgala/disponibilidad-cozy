import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TIPOS_PROPIEDAD } from '../../comun/codigos';

// `destino` y `habitaciones` no se aceptan: destino se copia del nombre de la ciudad
// y habitaciones se calcula contando las filas de la tabla habitaciones.
export class CreateAlojamientoDto {
  @ApiProperty({ description: 'Nombre del alojamiento', example: 'Resort Las Palmas', maxLength: 255 })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ description: 'Identificador de la ciudad (debe existir en /ciudades)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  ciudadId: number;

  @ApiPropertyOptional({ description: 'Descripción del alojamiento', example: 'Hotel frente al mar con vista panorámica.' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Moneda ISO 4217 (3 letras; se guarda en mayúsculas). Por defecto USD',
    example: 'USD',
    pattern: '^[A-Z]{3}$',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'moneda debe ser un código ISO de 3 letras (ej. "USD")' })
  moneda?: string;

  @ApiProperty({ description: 'Precio por noche (máximo 2 decimales)', example: 120.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99999999.99)
  precioPorNoche: number;

  @ApiProperty({ description: 'Capacidad de adultos permitida', example: 2 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacidadAdultos: number;

  @ApiProperty({ description: 'Capacidad de niños permitida', example: 1 })
  @IsInt()
  @Min(0)
  @Max(100)
  capacidadNinos: number;

  @ApiProperty({ description: 'Indica si el alojamiento tiene piscina', example: true })
  @IsBoolean()
  tienePiscina: boolean;

  @ApiPropertyOptional({
    description: 'URLs de las fotos',
    type: [String],
    example: ['https://picsum.photos/seed/hotel-1/800/600'],
  })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  fotos?: string[];

  @ApiPropertyOptional({ description: 'Facilidades que ofrece', type: [String], example: ['wifi', 'piscina', 'desayuno'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  facilidades?: string[];

  @ApiPropertyOptional({
    description: 'Políticas del alojamiento (objeto libre)',
    type: 'object',
    additionalProperties: true,
    example: { checkin: '15:00', checkout: '12:00', mascotas: false },
  })
  @IsOptional()
  @IsObject()
  politicas?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Estado del alojamiento. Por defecto true. Permite reactivar uno dado de baja (DELETE)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({ description: 'Estrellas del alojamiento (1 a 5). Por defecto 3', example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  estrellas?: number;

  @ApiPropertyOptional({ description: 'Tipo de propiedad del contrato v2. Por defecto HOTEL', enum: TIPOS_PROPIEDAD, example: 'HOTEL' })
  @IsOptional()
  @IsIn(TIPOS_PROPIEDAD)
  tipoPropiedad?: string;

  @ApiPropertyOptional({ description: 'Dirección del alojamiento', example: 'Av. Amazonas N24-03, Quito', maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  direccion?: string | null;

  @ApiPropertyOptional({ description: 'Latitud (-90 a 90, hasta 6 decimales)', example: -0.2201, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitud?: number | null;

  @ApiPropertyOptional({ description: 'Longitud (-180 a 180, hasta 6 decimales)', example: -78.5123, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitud?: number | null;
}
