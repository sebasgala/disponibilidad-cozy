import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { DemasiadosIntentosException } from '../../comun/problems/problem-details.exceptions';

// Límite de intentos por ruta. En el login la clave es IP + correo (5 por minuto, con @Throttle en la ruta);
// así alguien que prueba contraseñas de un correo se bloquea, sin bloquear a otros usuarios de la misma red.
// Responde 429 en problem+json con Retry-After.
@Injectable()
export class LimiteIntentosGuard extends ThrottlerGuard {
  protected async getTracker(peticion: Record<string, any>): Promise<string> {
    const correo = typeof peticion.body?.email === 'string' ? peticion.body.email.trim().toLowerCase() : '';
    return `${peticion.ip}|${correo}`;
  }

  protected async throwThrottlingException(_: ExecutionContext, detalle: ThrottlerLimitDetail): Promise<void> {
    const segundos = Math.max(1, detalle.timeToBlockExpire || detalle.timeToExpire || 60);
    throw new DemasiadosIntentosException(`Demasiados intentos: espera ${segundos} segundos antes de volver a probar`, segundos);
  }
}

// Variante por IP sola, para rutas sin correo en la clave (p. ej. consultar una reserva por localizador).
@Injectable()
export class LimiteIntentosPorIpGuard extends LimiteIntentosGuard {
  protected async getTracker(peticion: Record<string, any>): Promise<string> {
    return String(peticion.ip);
  }
}
