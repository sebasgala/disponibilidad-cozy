import { RolUsuario, Usuario } from './entities/usuario.entity';

// Contrato de identidad que usuarios ofrece a los otros dominios (fase 8.0): el usuario de la sesión tal como lo
// deja JwtAuthGuard. Los demás dominios solo ven esto, nunca la entidad ni la tabla `usuarios`.
// Fase 8.1: estos datos salen del token (id, rol y estado, vida de 10 minutos); no se lee la base en cada petición.
export { RolUsuario };

export type UsuarioSesion = Pick<Usuario, 'id' | 'rol'>;
