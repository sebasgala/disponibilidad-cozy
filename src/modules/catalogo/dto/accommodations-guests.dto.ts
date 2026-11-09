import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';

// Elemento de `allocation` del contrato: cómo se reparten los huéspedes en una habitación.
export class GuestsAllocationDto {
  @ApiPropertyOptional({ type: 'integer', example: 2 })
  @IsOptional()
  @IsInt()
  adults?: number;

  @ApiPropertyOptional({ type: 'integer', isArray: true, example: [5] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  children?: number[];
}

// Esquema `AccommodationsGuests` del contrato.
export class AccommodationsGuestsDto {
  @ApiProperty({ type: 'integer', description: 'Cantidad de adultos (mínimo 1)', example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  number_of_adults: number;

  @ApiProperty({ type: 'integer', description: 'Cantidad de habitaciones (mínimo 1)', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  number_of_rooms: number;

  @ApiPropertyOptional({ description: 'Edades de los niños', type: 'integer', isArray: true, example: [5] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  children?: number[];

  @ApiPropertyOptional({ description: 'Reparto de huéspedes por habitación (se valida pero no se usa)', type: () => [GuestsAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuestsAllocationDto)
  allocation?: GuestsAllocationDto[];
}
