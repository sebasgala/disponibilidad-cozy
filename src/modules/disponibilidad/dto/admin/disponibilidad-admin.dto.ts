import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { IsFechaIso } from '../../../comun/dto/decorators/is-fecha-iso.decorator';

const CUPOS_MAXIMOS = 10000;

// Rango de fechas [desde, hasta], ambos incluidos. Máximo 366 días (se valida en el servicio).
export class RangoFechasQueryDto {
  @ApiProperty({ description: 'Primera fecha (incluida), YYYY-MM-DD', format: 'date', example: '2026-10-20' })
  @IsFechaIso()
  desde: string;

  @ApiProperty({ description: 'Última fecha (incluida), YYYY-MM-DD. Máximo 366 días desde `desde`', format: 'date', example: '2026-10-26' })
  @IsFechaIso()
  hasta: string;
}

// Editar un día. Al menos uno de los dos campos. Si el día no existe, se crea y hacen falta los dos.
export class EditarDiaDto {
  @ApiPropertyOptional({
    type: 'integer',
    description: 'Habitaciones que EXISTEN esa noche. Los cupos que quedan se ajustan solos: cupos += nuevoTotal - totalAnterior',
    example: 6,
    minimum: 0,
    maximum: CUPOS_MAXIMOS,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CUPOS_MAXIMOS)
  cuposTotales?: number;

  @ApiPropertyOptional({ description: 'Precio de esa noche (máximo 2 decimales)', example: 99.5, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  precio?: number;

  @ApiPropertyOptional({ description: 'true = solo devuelve lo que cambiaría, sin guardar', default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

// Editar un rango en una sola operación (todo o nada).
export class EditarRangoDto extends EditarDiaDto {
  @ApiProperty({ description: 'Primera fecha (incluida)', format: 'date', example: '2026-10-20' })
  @IsFechaIso()
  desde: string;

  @ApiProperty({ description: 'Última fecha (incluida). Máximo 366 días desde `desde`', format: 'date', example: '2026-10-26' })
  @IsFechaIso()
  hasta: string;

  @ApiPropertyOptional({
    description: 'Solo estos días de la semana (0 = domingo … 6 = sábado). Si se omite, todos',
    type: 'integer',
    isArray: true,
    example: [5, 6],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana?: number[];
}

export class DiaDisponibilidadDto {
  @ApiProperty({ format: 'date', example: '2026-10-20' })
  fecha: string;

  @ApiProperty({ type: 'integer', description: 'Habitaciones que existen esa noche', example: 6 })
  cuposTotales: number;

  @ApiProperty({ type: 'integer', description: 'Habitaciones que quedan para vender', example: 4 })
  cupos: number;

  @ApiProperty({ type: 'integer', description: 'Habitaciones ya vendidas (cuposTotales - cupos)', example: 2 })
  vendidas: number;

  @ApiProperty({ example: 109.25 })
  precio: number;
}

export class DisponibilidadAdminResponseDto {
  @ApiProperty({ format: 'uuid' })
  habitacionId: string;

  @ApiProperty({ format: 'date' })
  desde: string;

  @ApiProperty({ format: 'date' })
  hasta: string;

  @ApiProperty({ type: () => [DiaDisponibilidadDto], description: 'Solo los días que tienen fila; un día sin fila no se vende' })
  dias: DiaDisponibilidadDto[];
}

export class CambioDisponibilidadDto {
  @ApiProperty({ format: 'date', example: '2026-10-20' })
  fecha: string;

  @ApiProperty({ enum: ['crear', 'actualizar', 'sin_cambios'], example: 'actualizar' })
  accion: 'crear' | 'actualizar' | 'sin_cambios';

  @ApiProperty({ type: () => DiaDisponibilidadDto, nullable: true, description: 'null si el día no existía' })
  antes: DiaDisponibilidadDto | null;

  @ApiProperty({ type: () => DiaDisponibilidadDto })
  despues: DiaDisponibilidadDto;
}

export class ResumenCambiosDto {
  @ApiProperty({ type: 'integer', example: 0 })
  creados: number;

  @ApiProperty({ type: 'integer', example: 5 })
  actualizados: number;

  @ApiProperty({ type: 'integer', example: 2 })
  sinCambios: number;
}

export class EdicionDisponibilidadResponseDto {
  @ApiProperty({ format: 'uuid' })
  habitacionId: string;

  @ApiProperty({ description: 'true = vista previa: no se guardó nada', example: false })
  dryRun: boolean;

  @ApiProperty({ type: () => ResumenCambiosDto })
  resumen: ResumenCambiosDto;

  @ApiProperty({ type: () => [CambioDisponibilidadDto] })
  cambios: CambioDisponibilidadDto[];
}
