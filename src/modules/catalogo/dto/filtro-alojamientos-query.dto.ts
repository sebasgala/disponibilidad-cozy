import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// Paginación (page, limit) de la plantilla + filtros opcionales del listado de admin.
export class FiltroAlojamientosQueryDto extends PaginationQueryDto {
  // Se vuelve a declarar solo para poner un tope y evitar listados enormes.
  @ApiPropertyOptional({ description: 'Elementos por página (máximo 100)', default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Filtrar por ciudad', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  ciudadId?: number;

  @ApiPropertyOptional({ description: 'Filtrar por estado (true = activos, false = dados de baja)', type: Boolean, example: true })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  activo?: boolean;

  @ApiPropertyOptional({ description: 'Contar también las habitaciones desactivadas en `habitaciones` (por defecto solo activas)', type: Boolean, example: false })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  incluirInactivas?: boolean;
}
