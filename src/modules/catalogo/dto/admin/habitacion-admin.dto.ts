import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';
import { BaseResponseDto } from '../../../../common/dto/base-response.dto';

// Crear una habitación (tipo de habitación) de un alojamiento. No crea disponibilidad: se carga aparte
// con /admin/habitaciones/{id}/disponibilidad.
export class CrearHabitacionDto {
  @ApiProperty({ description: 'Nombre visible de la habitación', example: 'Suite Familiar', maxLength: 255 })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ description: 'Tipo de habitación', example: 'familiar', maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  tipo: string;

  @ApiProperty({ type: 'integer', description: 'Adultos por habitación', example: 4, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  capacidadAdultos: number;

  @ApiProperty({ type: 'integer', description: 'Niños por habitación', example: 2, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  capacidadNinos: number;

  @ApiProperty({ description: 'Precio de catálogo (el precio real por noche está en la disponibilidad)', example: 130, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  precioBase: number;

  @ApiPropertyOptional({ description: 'Plan de comidas', example: 'breakfast_included', maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mealPlan?: string | null;

  @ApiPropertyOptional({ description: 'Tipo de cancelación', example: 'free_cancellation', maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cancellationType?: string | null;

  @ApiPropertyOptional({ description: 'Descripción de la habitación', example: 'Suite con vista a la ciudad.', nullable: true })
  @IsOptional()
  @IsString()
  descripcion?: string | null;

  @ApiPropertyOptional({ description: 'Camas de la habitación', example: '1 king', maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  camas?: string | null;

  @ApiPropertyOptional({ type: 'integer', description: 'Metros cuadrados', example: 35, minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  metrosCuadrados?: number | null;

  @ApiPropertyOptional({ description: 'URLs de las fotos de la habitación', type: [String], nullable: true })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  fotos?: string[] | null;

  @ApiPropertyOptional({ description: 'Amenidades de la habitación', type: [String], example: ['wifi', 'tv'], nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenidades?: string[] | null;
}

// PATCH: solo los campos enviados. El estado (activo) se cambia con /desactivar y /reactivar.
export class ActualizarHabitacionDto extends PartialType(CrearHabitacionDto) {}

export class FiltroHabitacionesQueryDto {
  @ApiPropertyOptional({ description: 'Incluir las habitaciones desactivadas (por defecto solo activas)', type: Boolean, example: false })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  incluirInactivas?: boolean;
}

export class HabitacionAdminResponseDto extends BaseResponseDto {
  @ApiProperty({ format: 'uuid', example: '704fe49f-9024-4f7e-b023-df55a3aab5c1' })
  id: string;

  @ApiProperty({ type: 'integer', example: 1 })
  alojamientoId: number;

  @ApiProperty({ example: 'Suite Junior' })
  nombre: string;

  @ApiProperty({ example: 'suite' })
  tipo: string;

  @ApiProperty({ type: 'integer', example: 2 })
  capacidadAdultos: number;

  @ApiProperty({ type: 'integer', example: 2 })
  capacidadNinos: number;

  @ApiProperty({ example: 95 })
  precioBase: number;

  @ApiProperty({ example: 'breakfast_included', nullable: true })
  mealPlan: string | null;

  @ApiProperty({ example: 'free_cancellation', nullable: true })
  cancellationType: string | null;

  @ApiProperty({ description: 'false = desactivada (borrado lógico): no se vende, pero sus órdenes siguen vigentes', example: true })
  activo: boolean;

  @ApiProperty({ description: 'Código del tipo de habitación en el contrato v2 (se genera solo y no cambia)', example: 'SUITE_DELUXE' })
  codigo: string;

  @ApiProperty({ description: 'Descripción', nullable: true })
  descripcion: string | null;

  @ApiProperty({ description: 'Camas', nullable: true })
  camas: string | null;

  @ApiProperty({ description: 'Metros cuadrados', nullable: true })
  metrosCuadrados: number | null;

  @ApiProperty({ description: 'Fotos', type: [String], nullable: true })
  fotos: string[] | null;

  @ApiProperty({ description: 'Amenidades', type: [String], nullable: true })
  amenidades: string[] | null;
}
