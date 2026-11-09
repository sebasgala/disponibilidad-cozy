import { Request } from 'express';
import { EstadoUsuario, RolUsuario } from '../entities/usuario.entity';

// Sesión que el token deja en la petición (fase 8.1): el id, el rol y el estado con que se emitió el token.
// JwtAuthGuard solo verifica la firma y el vencimiento: NO lee la cuenta. Un cambio de rol o una suspensión se nota
// cuando vence el token (10 minutos) o cuando falla la renovación (POST /auth/renovar, que sí lee la cuenta).
export interface SesionJwt {
  id: string;
  rol: RolUsuario;
  estado: EstadoUsuario;
}

// Petición ya autenticada: JwtAuthGuard deja aquí la sesión que trae el token.
export interface PeticionAutenticada extends Request {
  usuario: SesionJwt;
}

// Contenido del JWT: el id (sub) y el rol y el estado que tenía la cuenta cuando se emitió (login o renovación).
// Un token anterior a la fase 8.1 (solo `sub`) ya no sirve: hay que iniciar sesión otra vez.
export interface CargaJwt {
  sub: string;
  rol: RolUsuario;
  estado: EstadoUsuario;
}
