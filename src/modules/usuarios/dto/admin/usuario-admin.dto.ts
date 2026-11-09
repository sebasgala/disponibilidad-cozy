import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { EstadoUsuario, RolUsuario } from '../../entities/usuario.entity';
import { UsuarioResponseDto } from '../auth/auth.dto';

export class FiltroUsuariosQueryDto {
  @ApiPropertyOptional({ enum: RolUsuario })
  @IsOptional()
  @IsEnum(RolUsuario, { message: 'debe ser cliente, administrador o superadmin' })
  rol?: RolUsuario;

  @ApiPropertyOptional({ enum: EstadoUsuario })
  @IsOptional()
  @IsEnum(EstadoUsuario, { message: 'debe ser pendiente, activo o suspendido' })
  estado?: EstadoUsuario;

  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number = 1;

  @ApiPropertyOptional({ type: 'integer', default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class CambiarRolDto {
  @ApiProperty({ enum: RolUsuario, example: RolUsuario.ADMINISTRADOR })
  @IsEnum(RolUsuario, { message: 'debe ser cliente, administrador o superadmin' })
  @IsNotEmpty({ message: 'es obligatorio' })
  rol: RolUsuario;
}

export class PaginaMetaDto {
  @ApiProperty({ type: 'integer', example: 25 })
  totalItems: number;

  @ApiProperty({ type: 'integer', example: 10 })
  itemCount: number;

  @ApiProperty({ type: 'integer', example: 10 })
  itemsPerPage: number;

  @ApiProperty({ type: 'integer', example: 3 })
  totalPages: number;

  @ApiProperty({ type: 'integer', example: 1 })
  currentPage: number;
}

export class UsuariosPaginadosDto {
  @ApiProperty({ type: () => [UsuarioResponseDto] })
  data: UsuarioResponseDto[];

  @ApiProperty({ type: () => PaginaMetaDto })
  meta: PaginaMetaDto;
}
