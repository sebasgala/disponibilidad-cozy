import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCiudadDto {
  @ApiProperty({ description: 'Nombre de la ciudad', example: 'Quito', maxLength: 120 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  @ApiProperty({
    description: 'Código de país ISO 3166-1 alpha-2 (2 letras; se guarda en minúsculas)',
    example: 'ec',
    pattern: '^[a-z]{2}$',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'pais debe ser un código ISO de 2 letras (ej. "ec")' })
  pais: string;
}
