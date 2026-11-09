import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ahoraDelTokenDePrueba } from '../../comun/v2/reloj-prueba';
import { AuthService } from './auth.service';
import { PeticionAutenticada } from './seguridad.tipos';

// Exige un token válido y vigente. Sin token o con token inválido o vencido: 401.
// Fase 8.1: NO lee la cuenta. La sesión (id, rol y estado) sale del token, que dura 10 minutos; una suspensión o un
// cambio de rol se nota al vencer el token o cuando falla POST /auth/renovar (403 ACCOUNT_SUSPENDED).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    peticion.usuario = await this.authService.sesionDelToken(peticion.headers.authorization, ahoraDelTokenDePrueba(peticion));
    return true;
  }
}
