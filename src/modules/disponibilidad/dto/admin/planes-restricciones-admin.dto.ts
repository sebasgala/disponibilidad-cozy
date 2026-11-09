import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { BaseResponseDto } from '../../../../common/dto/base-response.dto';
import { IsFechaIso } from '../../../comun/dto/decorators/is-fecha-iso.decorator';

const REGIMENES = ['SOLO_HABITACION', 'DESAYUNO_INCLUIDO', 'MEDIA_PENSION', 'PENSION_COMPLETA', 'TODO_INCLUIDO'];
const MODELOS_PAGO = ['PREPAGO', 'PAGO_EN_HOTEL', 'GARANTIA_TARJETA'];

// ───────────────────────── Planes de tarifa ─────────────────────────

// Plan ADICIONAL de una habitación. El plan por defecto (ESTANDAR) se deriva de la habitación y no se crea aquí.
export class CrearPlanTarifaDto {
  @ApiProperty({ description: 'Código del plan (A-Z, 0-9, _). ESTANDAR está reservado. No se puede cambiar después', example: 'NO_REEMBOLSABLE' })
  @Matches(/^(?!ESTANDAR$)[A-Z0-9_]{2,30}$/, { message: 'codigo debe tener 2 a 30 caracteres A-Z, 0-9 o _ y no puede ser ESTANDAR' })
  codigo: string;

  @ApiProperty({ description: 'Nombre visible del plan', example: 'No reembolsable', maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre: string;

  @ApiProperty({ description: 'Régimen de comidas', enum: REGIMENES, example: 'SOLO_HABITACION' })
  @IsIn(REGIMENES)
  regimen: string;

  @ApiPropertyOptional({ description: 'Modelo de pago. Por defecto PREPAGO', enum: MODELOS_PAGO, example: 'PREPAGO' })
  @IsOptional()
  @IsIn(MODELOS_PAGO)
  modeloPago?: string;

  @ApiProperty({ description: 'true = se puede cancelar con reembolso', example: false })
  @IsBoolean()
  esReembolsable: boolean;

  @ApiPropertyOptional({ type: 'integer', description: 'Horas antes de la llegada hasta las que se cancela sin costo', example: 48, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  horasLimiteCancelacion?: number | null;

  @ApiPropertyOptional({ description: 'Penalidad (%) si se cancela fuera de la ventana', example: 100, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  penalidadPorcentaje?: number | null;

  @ApiPropertyOptional({ description: 'Ajuste sobre el precio del día (%). −10 = 10 % más barato. Por defecto 0', example: -10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-90)
  @Max(500)
  ajustePorcentaje?: number;

  @ApiPropertyOptional({ type: 'integer', description: 'Adultos incluidos en el precio por habitación. Por defecto 2', example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  ocupacionBase?: number;

  @ApiPropertyOptional({ description: 'Suplemento por noche y por adulto sobre la ocupación base. Por defecto 0', example: 15 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  suplementoAdultoExtra?: number;

  @ApiPropertyOptional({ type: 'integer', description: 'Los niños de esta edad o menos no pagan suplemento. Por defecto 17', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(17)
  edadMaximaGratisNinos?: number;

  @ApiPropertyOptional({ description: 'Suplemento por noche y por niño mayor de esa edad. Por defecto 0', example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  suplementoNino?: number;
}

// PATCH: todo opcional salvo el código, que no cambia. `activo` = false lo saca de la venta.
export class ActualizarPlanTarifaDto extends PartialType(OmitType(CrearPlanTarifaDto, ['codigo'] as const)) {
  @ApiPropertyOptional({ description: 'false = el plan deja de venderse', example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class PlanTarifaAdminResponseDto extends BaseResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) habitacionId: string;
  @ApiProperty({ example: 'NO_REEMBOLSABLE' }) codigo: string;
  @ApiProperty({ example: 'No reembolsable' }) nombre: string;
  @ApiProperty({ enum: REGIMENES }) regimen: string;
  @ApiProperty({ enum: MODELOS_PAGO }) modeloPago: string;
  @ApiProperty() esReembolsable: boolean;
  @ApiProperty({ nullable: true, type: 'integer' }) horasLimiteCancelacion: number | null;
  @ApiProperty({ nullable: true }) penalidadPorcentaje: number | null;
  @ApiProperty({ example: -10 }) ajustePorcentaje: number;
  @ApiProperty({ type: 'integer' }) ocupacionBase: number;
  @ApiProperty() suplementoAdultoExtra: number;
  @ApiProperty({ type: 'integer' }) edadMaximaGratisNinos: number;
  @ApiProperty() suplementoNino: number;
  @ApiProperty() activo: boolean;
}

// ───────────────────────── Restricciones por noche ─────────────────────────

// Editar las restricciones de [desde, hasta] (ambos incluidos). Solo cambian los campos enviados; null quita una
// restricción numérica. Una noche que queda sin ninguna restricción se borra.
export class EditarRestriccionesDto {
  @ApiProperty({ description: 'Primera noche (incluida)', format: 'date', example: '2026-12-20' })
  @IsFechaIso()
  desde: string;

  @ApiProperty({ description: 'Última noche (incluida). Máximo 366 días desde `desde`', format: 'date', example: '2026-12-31' })
  @IsFechaIso()
  hasta: string;

  @ApiPropertyOptional({ description: 'Solo estos días de la semana (0 = domingo … 6 = sábado). Si se omite, todos', type: 'integer', isArray: true, example: [5, 6] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana?: number[];

  @ApiPropertyOptional({ type: 'integer', description: 'MIN_STAY: noches mínimas llegando esa noche (null la quita)', minimum: 1, maximum: 30, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  estanciaMinima?: number | null;

  @ApiPropertyOptional({ type: 'integer', description: 'MAX_STAY: noches máximas llegando esa noche (null la quita)', minimum: 1, maximum: 30, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  estanciaMaxima?: number | null;

  @ApiPropertyOptional({ description: 'CLOSED_TO_ARRIVAL: no se admiten llegadas esa noche' })
  @IsOptional()
  @IsBoolean()
  cerradoALlegada?: boolean;

  @ApiPropertyOptional({ description: 'CLOSED_TO_DEPARTURE: no se admiten salidas ese día' })
  @IsOptional()
  @IsBoolean()
  cerradoASalida?: boolean;

  @ApiPropertyOptional({ description: 'STOP_SELL: la noche no se vende' })
  @IsOptional()
  @IsBoolean()
  ventaCerrada?: boolean;

  @ApiPropertyOptional({ type: 'integer', description: 'CUTOFF: horas mínimas de anticipación respecto a las 14:00 de la llegada (null la quita)', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  anticipacionMinimaHoras?: number | null;
}

export class RestriccionDiaAdminDto {
  @ApiProperty({ format: 'date' }) fecha: string;
  @ApiProperty({ nullable: true, type: 'integer' }) estanciaMinima: number | null;
  @ApiProperty({ nullable: true, type: 'integer' }) estanciaMaxima: number | null;
  @ApiProperty() cerradoALlegada: boolean;
  @ApiProperty() cerradoASalida: boolean;
  @ApiProperty() ventaCerrada: boolean;
  @ApiProperty({ nullable: true, type: 'integer' }) anticipacionMinimaHoras: number | null;
}

export class RestriccionesAdminResponseDto extends BaseResponseDto {
  @ApiProperty({ format: 'uuid' }) habitacionId: string;
  @ApiProperty({ format: 'date' }) desde: string;
  @ApiProperty({ format: 'date' }) hasta: string;
  @ApiProperty({ type: () => [RestriccionDiaAdminDto], description: 'Solo las noches que tienen alguna restricción' })
  data: RestriccionDiaAdminDto[];
}
