import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuariosAdminController } from './admin/usuarios-admin.controller';
import { UsuariosAdminService } from './admin/usuarios-admin.service';
import { Usuario } from './entities/usuario.entity';
import { AuthController } from './seguridad/auth.controller';
import { AuthService } from './seguridad/auth.service';
import { ClavePublicaJwtController, construirOpcionesJwt } from './seguridad/claves-jwt';
import { CuentaController } from './seguridad/cuenta.controller';
import { JwtAuthGuard } from './seguridad/jwt-auth.guard';
import { LimiteIntentosGuard, LimiteIntentosPorIpGuard } from './seguridad/limite-intentos.guard';
import { RolesGuard } from './seguridad/roles.guard';
import { AutenticacionV2Guard, AutenticacionV2Service } from './v2/autenticacion-v2';
import { CONEXION } from '../../database/conexiones';

const PROVEEDORES_SEGURIDAD = [
  AuthService,
  JwtAuthGuard,
  RolesGuard,
  LimiteIntentosGuard,
  LimiteIntentosPorIpGuard,
  AutenticacionV2Service,
  AutenticacionV2Guard,
];

// Dominio usuarios (fase 8.0): cuentas, login, JWT de Cozy, roles y la autenticación del contrato v2.
// Es el único que lee la tabla `usuarios`. Los demás dominios usan sus guardas y su contrato (usuarios.contrato.ts).
@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario], CONEXION.usuarios),
    // Fase 9.4 (D3): usuarios firma con la clave privada RS256 (JWT_PRIVATE_KEY); mantiene JWT_SECRET solo para pruebas sin par RSA.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        construirOpcionesJwt('firmar_y_verificar', {
          JWT_PRIVATE_KEY: config.get<string>('JWT_PRIVATE_KEY') ?? process.env.JWT_PRIVATE_KEY,
          JWT_PUBLIC_KEY: config.get<string>('JWT_PUBLIC_KEY') ?? process.env.JWT_PUBLIC_KEY,
          JWT_SECRET: config.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET,
          JWT_ISSUER: config.get<string>('JWT_ISSUER') ?? process.env.JWT_ISSUER,
          JWT_AUDIENCE: config.get<string>('JWT_AUDIENCE') ?? process.env.JWT_AUDIENCE,
        }),
    }),
    // Límites por defecto de las rutas que usan LimiteIntentosGuard (cada ruta fija el suyo con @Throttle). Global.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
  ],
  controllers: [AuthController, CuentaController, UsuariosAdminController, ClavePublicaJwtController],
  providers: [...PROVEEDORES_SEGURIDAD, UsuariosAdminService],
  exports: PROVEEDORES_SEGURIDAD,
})
export class UsuariosModule {}

// Guardas JWT y verificación de firma para procesos de dominio que no son dueños de la tabla `usuarios` (fase 9.2).
// Valida el token sin consultar la base de datos.
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        construirOpcionesJwt('solo_verificar', {
          JWT_PRIVATE_KEY: config.get<string>('JWT_PRIVATE_KEY') ?? process.env.JWT_PRIVATE_KEY,
          JWT_PUBLIC_KEY: config.get<string>('JWT_PUBLIC_KEY') ?? process.env.JWT_PUBLIC_KEY,
          JWT_SECRET: config.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET,
          JWT_ISSUER: config.get<string>('JWT_ISSUER') ?? process.env.JWT_ISSUER,
          JWT_AUDIENCE: config.get<string>('JWT_AUDIENCE') ?? process.env.JWT_AUDIENCE,
        }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
  ],
  providers: PROVEEDORES_SEGURIDAD,
  exports: PROVEEDORES_SEGURIDAD,
})
export class SeguridadUsuariosModule {}
