import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolUsuario } from '../entities/usuario.entity';
import { ProhibidoException } from '../../comun/problems/problem-details.exceptions';
import { CLAVE_ROLES } from './roles.decorator';
import { PeticionAutenticada } from './seguridad.tipos';

// Comprueba el rol. Va SIEMPRE después de JwtAuthGuard (que es quien deja `usuario` en la petición).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const permitidos = this.reflector.getAllAndOverride<RolUsuario[] | undefined>(CLAVE_ROLES, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!permitidos || permitidos.length === 0) return true;
    const { usuario } = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    if (!usuario || !permitidos.includes(usuario.rol)) {
      throw new ProhibidoException('Tu rol no tiene permiso para esta operación');
    }
    return true;
  }
}
