import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { TIPOS_EVENTO } from '../../../comun/entities/feed-evento.entity';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// GET /alojamientos/eventos
export class EventosQueryV2 {
  // Último `sequence` ya procesado: devuelve solo los mayores
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @IsIn(TIPOS_EVENTO)
  type?: string;
}

// GET /alojamientos/{id}/inventario
export class InventarioQueryV2 {
  @Matches(FECHA, { message: 'desde debe tener el formato YYYY-MM-DD' })
  desde: string;

  @Matches(FECHA, { message: 'hasta debe tener el formato YYYY-MM-DD' })
  hasta: string;

  @IsOptional()
  @Matches(/^[A-Z0-9_]{2,40}$/, { message: 'tipoHabitacion debe tener 2 a 40 caracteres A-Z, 0-9 o _' })
  tipoHabitacion?: string;
}
