import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const MONEY = /^(0|[1-9][0-9]{0,8})\.[0-9]{2}$/;
const REGIMENES = ['SOLO_HABITACION', 'DESAYUNO_INCLUIDO', 'MEDIA_PENSION', 'PENSION_COMPLETA', 'TODO_INCLUIDO'] as const;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const aBooleano = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// Parámetros page y limit del contrato (PageParam, LimitParam)
export class PaginaV2Query {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

// GET /alojamientos
export class ListarAlojamientosV2Query extends PaginaV2Query {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  estrellas?: number;

  @IsOptional()
  @Matches(MONEY, { message: 'minPrecio debe ser un importe Money, por ejemplo "120.00"' })
  minPrecio?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'maxPrecio debe ser un importe Money, por ejemplo "120.00"' })
  maxPrecio?: string;

  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  permitePaquete?: boolean;

  @IsOptional()
  @IsDateString()
  actualizadoDesde?: string;
}

// POST /alojamientos/search (cuerpo)
export class BuscarAlojamientosV2Dto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  destino: string;

  @Matches(FECHA, { message: 'fechaInicio debe tener el formato YYYY-MM-DD' })
  fechaInicio: string;

  @Matches(FECHA, { message: 'fechaFin debe tener el formato YYYY-MM-DD' })
  fechaFin: string;

  @IsInt()
  @Min(1)
  @Max(20)
  adultos: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  ninos?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  edadesNinos?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  habitaciones?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  estrellasMinimas?: number;

  @IsOptional()
  @Matches(MONEY, { message: 'precioMaximo debe ser un importe Money, por ejemplo "120.00"' })
  precioMaximo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  amenidadesDeseadas?: string[];

  @IsOptional()
  @IsIn(REGIMENES)
  regimen?: (typeof REGIMENES)[number];

  @IsOptional()
  @IsBoolean()
  permitePaquete?: boolean;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 de 3 letras en mayúsculas' })
  currency?: string;
}
