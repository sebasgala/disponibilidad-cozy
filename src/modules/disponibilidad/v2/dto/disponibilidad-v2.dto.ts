import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO_HABITACION = /^[A-Z0-9_]{2,40}$/;
const CODIGO_PLAN = /^[A-Z0-9_]{2,30}$/;
// AlojamientoId del contrato: las palabras de las rutas estáticas no son ids
export const ID_ALOJAMIENTO = /^(?!(health|eventos|categorias|tipos|orders|reservations|reservas|search|availability|promociones)$)[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const REGIMENES = ['SOLO_HABITACION', 'DESAYUNO_INCLUIDO', 'MEDIA_PENSION', 'PENSION_COMPLETA', 'TODO_INCLUIDO'] as const;

// Ocupantes del contrato
export class OcupantesV2Dto {
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
}

// POST /alojamientos/availability (AvailabilityRequestV2)
export class CotizarV2Dto {
  @IsString()
  @Matches(ID_ALOJAMIENTO, { message: 'alojamientoId no tiene el formato de un id de propiedad' })
  alojamientoId: string;

  @Matches(FECHA, { message: 'fechaInicio debe tener el formato YYYY-MM-DD' })
  fechaInicio: string;

  @Matches(FECHA, { message: 'fechaFin debe tener el formato YYYY-MM-DD' })
  fechaFin: string;

  @Matches(CODIGO_HABITACION, { message: 'tipoHabitacionCodigo debe tener 2 a 40 caracteres A-Z, 0-9 o _' })
  tipoHabitacionCodigo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  cantidadHabitaciones?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => OcupantesV2Dto)
  ocupantes?: OcupantesV2Dto;

  @IsOptional()
  @IsIn(REGIMENES)
  regimenSeleccionado?: (typeof REGIMENES)[number];

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 de 3 letras en mayúsculas' })
  currency?: string;

  @IsOptional()
  @Matches(CODIGO_PLAN, { message: 'planTarifaCodigo debe tener 2 a 30 caracteres A-Z, 0-9 o _' })
  planTarifaCodigo?: string;
}

// GET /alojamientos/{id}/availability (query)
export class OpcionesDisponibilidadV2Query {
  @Matches(FECHA, { message: 'checkin debe tener el formato YYYY-MM-DD' })
  checkin: string;

  @Matches(FECHA, { message: 'checkout debe tener el formato YYYY-MM-DD' })
  checkout: string;

  @IsOptional()
  @Matches(CODIGO_HABITACION, { message: 'tipoHabitacion debe tener 2 a 40 caracteres A-Z, 0-9 o _' })
  tipoHabitacion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  adults: number = 2;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  children: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rooms: number = 1;
}
