import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { EstadoUsuario, RolUsuario } from '../../entities/usuario.entity';

// Roles con los que se puede registrar uno mismo. El superadmin NO se registra: lo crea el seed.
// Contraseña nueva: al menos una letra (de cualquier alfabeto) y un dígito. Rechaza "12345678" y "aaaaaaaa".
// El login no la aplica, para no dejar fuera cuentas creadas antes de la regla.
export const REGLA_CONTRASENA = /^(?=.*\p{L})(?=.*\d)/u;

export const ROLES_DE_REGISTRO = [RolUsuario.CLIENTE, RolUsuario.ADMINISTRADOR] as const;

export class RegistroDto {
  @ApiProperty({ example: 'ana.perez@example.com', maxLength: 255 })
  @MaxLength(255, { message: 'no puede superar 255 caracteres' })
  @IsEmail({}, { message: 'formato inválido' })
  @IsNotEmpty({ message: 'es obligatorio' })
  email: string;

  // bcrypt solo usa los primeros 72 bytes: se limita para no aceptar contraseñas que se truncan en silencio.
  @ApiProperty({
    description: 'Entre 8 y 72 caracteres, con al menos una letra y un número',
    minLength: 8,
    maxLength: 72,
    example: 'una-clave-larga-123',
  })
  @Matches(REGLA_CONTRASENA, { message: 'debe incluir al menos una letra y un número' })
  @MaxLength(72, { message: 'no puede superar 72 caracteres' })
  @MinLength(8, { message: 'debe tener al menos 8 caracteres' })
  @IsString({ message: 'debe ser texto' })
  @IsNotEmpty({ message: 'es obligatoria' })
  password: string;

  @ApiProperty({ example: 'Ana', maxLength: 120 })
  @MaxLength(120, { message: 'no puede superar 120 caracteres' })
  @Matches(/\S/, { message: 'no puede estar vacío' })
  @IsString({ message: 'debe ser texto' })
  @IsNotEmpty({ message: 'es obligatorio' })
  nombre: string;

  @ApiProperty({ example: 'Pérez', maxLength: 120 })
  @MaxLength(120, { message: 'no puede superar 120 caracteres' })
  @Matches(/\S/, { message: 'no puede estar vacío' })
  @IsString({ message: 'debe ser texto' })
  @IsNotEmpty({ message: 'es obligatorio' })
  apellido: string;

  @ApiPropertyOptional({
    enum: ROLES_DE_REGISTRO,
    default: RolUsuario.CLIENTE,
    description: 'cliente nace activo; administrador nace pendiente hasta que el superadmin lo aprueba',
  })
  @IsOptional()
  @IsIn(ROLES_DE_REGISTRO, { message: 'debe ser cliente o administrador' })
  rol?: RolUsuario.CLIENTE | RolUsuario.ADMINISTRADOR;
}

export class LoginDto {
  @ApiProperty({ example: 'ana.perez@example.com' })
  @MaxLength(255, { message: 'no puede superar 255 caracteres' })
  @IsString({ message: 'debe ser texto' })
  @IsNotEmpty({ message: 'es obligatorio' })
  email: string;

  @ApiProperty({ example: 'una-clave-larga-123' })
  @MaxLength(72, { message: 'no puede superar 72 caracteres' })
  @IsString({ message: 'debe ser texto' })
  @IsNotEmpty({ message: 'es obligatoria' })
  password: string;
}

// Lo único que se muestra de un usuario. No incluye passwordHash.
export class UsuarioResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ana.perez@example.com' })
  email: string;

  @ApiProperty({ example: 'Ana' })
  nombre: string;

  @ApiProperty({ example: 'Pérez' })
  apellido: string;

  @ApiProperty({ enum: RolUsuario, example: RolUsuario.CLIENTE })
  rol: RolUsuario;

  @ApiProperty({ enum: EstadoUsuario, example: EstadoUsuario.ACTIVO })
  estado: EstadoUsuario;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT. Se envía en la cabecera `Authorization: Bearer <token>`' })
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: string;

  @ApiProperty({ type: 'integer', description: 'Segundos de vigencia', example: 600 })
  expires_in: number;

  @ApiProperty({ type: () => UsuarioResponseDto })
  usuario: UsuarioResponseDto;
}
