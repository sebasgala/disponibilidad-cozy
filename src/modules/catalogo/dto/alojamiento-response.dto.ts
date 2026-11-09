import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from '../../../common/dto/base-response.dto';
import { PaginatedResponseDto } from '../../../common/dto/paginated-response.dto';
import { CiudadResponseDto } from './ciudad-response.dto';

export class AlojamientoResponseDto extends BaseResponseDto {
  @ApiProperty({ description: 'Identificador entero del alojamiento', example: 1 })
  id: number;

  @ApiProperty({ description: 'Nombre del alojamiento', example: 'Resort Las Palmas' })
  nombre: string;

  @ApiProperty({ description: 'Destino: se llena solo con el nombre de la ciudad', example: 'Quito' })
  destino: string;

  @ApiProperty({ description: 'Identificador de la ciudad', example: 1, nullable: true })
  ciudadId: number | null;

  @ApiProperty({ description: 'Ciudad donde está el alojamiento', type: () => CiudadResponseDto, nullable: true })
  ciudad: CiudadResponseDto | null;

  @ApiProperty({ description: 'Descripción del alojamiento', example: 'Hotel boutique en el centro histórico.', nullable: true })
  descripcion: string | null;

  @ApiProperty({ description: 'Moneda ISO 4217', example: 'USD' })
  moneda: string;

  @ApiProperty({ description: 'Precio por noche', example: 120.5 })
  precioPorNoche: number;

  @ApiProperty({ description: 'Capacidad de adultos', example: 2 })
  capacidadAdultos: number;

  @ApiProperty({ description: 'Capacidad de niños', example: 1 })
  capacidadNinos: number;

  @ApiProperty({ description: 'Cantidad de habitaciones activas (con incluirInactivas=true, todas). Se calcula contando la tabla habitaciones', example: 3 })
  habitaciones: number;

  @ApiProperty({ description: 'Disponibilidad de piscina', example: true })
  tienePiscina: boolean;

  @ApiProperty({ description: 'URLs de las fotos', type: [String], nullable: true })
  fotos: string[] | null;

  @ApiProperty({ description: 'Facilidades que ofrece', type: [String], nullable: true })
  facilidades: string[] | null;

  @ApiProperty({ description: 'Políticas del alojamiento', type: 'object', additionalProperties: true, nullable: true })
  politicas: Record<string, any> | null;

  @ApiProperty({ description: 'false = dado de baja (borrado lógico)', example: true })
  activo: boolean;

  @ApiProperty({ description: 'Última modificación', type: String, format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ description: 'Código público del contrato v2 (se genera solo y no cambia)', example: 'HTL-COZY-UIO-001' })
  codigo: string;

  @ApiProperty({ description: 'Estrellas (1 a 5)', example: 4 })
  estrellas: number;

  @ApiProperty({ description: 'Tipo de propiedad', enum: ['HOTEL', 'RESORT', 'APARTAMENTO', 'HOSTAL', 'HOSTERIA'], example: 'HOTEL' })
  tipoPropiedad: string;

  @ApiProperty({ description: 'Dirección', nullable: true, example: 'Av. Amazonas N24-03, Quito' })
  direccion: string | null;

  @ApiProperty({ description: 'Latitud', nullable: true, example: -0.2201 })
  latitud: number | null;

  @ApiProperty({ description: 'Longitud', nullable: true, example: -78.5123 })
  longitud: number | null;
}

// Igual que PaginatedResponseDto de la plantilla, pero con el tipo de `data` para que Swagger lo muestre.
export class PaginatedAlojamientosResponseDto extends PaginatedResponseDto<AlojamientoResponseDto> {
  @ApiProperty({ description: 'Alojamientos de la página actual', type: () => [AlojamientoResponseDto] })
  data: AlojamientoResponseDto[];
}
