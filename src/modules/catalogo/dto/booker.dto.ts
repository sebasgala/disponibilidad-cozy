import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, Matches } from 'class-validator';

// Esquema `Booker` del contrato: quién hace la consulta.
export class BookerDto {
  @ApiProperty({ description: 'Código ISO 3166-1 alpha-2 del país del comprador', example: 'ec', pattern: '^[a-z]{2}$' })
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'country debe ser un código ISO de 2 letras minúsculas (ej. "ec")' })
  country: string;

  @ApiProperty({ example: 'desktop', enum: ['android', 'desktop', 'ios', 'mobile', 'tablet'] })
  @IsIn(['android', 'desktop', 'ios', 'mobile', 'tablet'])
  platform: string;

  @ApiPropertyOptional({ example: 'pi', pattern: '^[a-z]{2}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'state debe ser un código de 2 letras minúsculas' })
  state?: string;

  @ApiPropertyOptional({ example: 'leisure', enum: ['business', 'leisure'] })
  @IsOptional()
  @IsIn(['business', 'leisure'])
  travel_purpose?: string;

  @ApiPropertyOptional({ type: [String], enum: ['authenticated'], example: ['authenticated'] })
  @IsOptional()
  @IsArray()
  @IsIn(['authenticated'], { each: true })
  user_groups?: string[];
}
