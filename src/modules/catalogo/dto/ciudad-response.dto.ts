import { ApiProperty } from '@nestjs/swagger';

export class CiudadResponseDto {
  @ApiProperty({ description: 'Identificador entero de la ciudad', example: 1 })
  id: number;

  @ApiProperty({ description: 'Nombre de la ciudad', example: 'Quito' })
  nombre: string;

  @ApiProperty({ description: 'Código de país ISO 3166-1 alpha-2 en minúsculas', example: 'ec' })
  pais: string;
}
