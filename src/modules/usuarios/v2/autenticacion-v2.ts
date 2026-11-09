import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { RolUsuario } from '../entities/usuario.entity';
import { AuthService } from '../seguridad/auth.service';
import { ProblemaV2Exception } from '../../comun/v2/problemas-v2';
import { ahoraDelTokenDePrueba } from '../../comun/v2/reloj-prueba';
import { OPERACION_V2, REQUISITOS_V2, RequisitosV2 } from './seguridad-v2';

// Quién llama a una operación protegida de la v2 (contrato §7). Credenciales que se aceptan:
//   Bearer OAuth2   token de máquina a máquina (client_credentials) firmado por el emisor de Booking, con claim `scope`
//                   (o `scp`). Rol SERVICE; la operación exige su scope concreto => 403 INSUFFICIENT_SCOPE si falta.
//   Bearer usuario  el token de /api/v1/auth/login (cliente => CLIENTE; administrador y superadmin => ADMIN) o un JWT del
//                   emisor con claims `sub` y `roles` (sin `scope`).
//   X-API-Key       llave precompartida heredada (DEPRECADA, rol SERVICE). V2_API_KEY la fija.
// Sin credenciales => 401: el contrato no admite mutaciones anónimas. Cada operación declara con @OperacionV2 cuáles de
// las tres acepta (REQUISITOS_V2, espejo del `security` del contrato).
export type RolV2 = 'SERVICE' | 'CLIENTE' | 'ADMIN';

export interface PrincipalV2 {
  rol: RolV2;
  usuarioId?: string;
  // Un administrador solo ve las órdenes de sus alojamientos; el superadmin, todas
  superadmin?: boolean;
  // Con qué credencial entró (decide qué operaciones admite) y, si fue OAuth2, sus scopes
  via: 'apikey' | 'oauth' | 'usuario';
  scopes?: string[];
}

const LARGO_MINIMO_LLAVE = 16;
const LARGO_MINIMO_SECRETO_OAUTH = 32;
// "Token de corta vida (≤ 15 min)", contrato §7
const VIDA_MAXIMA_POR_DEFECTO_S = 900;

function igualSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Verificación de los tokens del emisor OAuth2. Quién lo es (P6 de la fase 0) está por confirmar, así que se configura:
//   OAUTH_JWT_SECRET       secreto compartido HS256 (≥ 32 caracteres), o
//   OAUTH_JWT_PUBLIC_KEY   clave pública PEM (RS256 / ES256; los saltos de línea pueden ir como \n)
//   OAUTH_ISSUER, OAUTH_AUDIENCE   si se definen, el token debe traerlos
//   OAUTH_VIDA_MAX_S       vida máxima exp - iat (900)
// Sin ninguna de las dos claves no se acepta ningún token OAuth2 (solo X-API-Key y el login de Cozy).
export interface ConfigOauth {
  secreto?: string;
  clavePublica?: string;
  emisor?: string;
  audiencia?: string;
  vidaMaximaS: number;
}

export function configOauth(env: NodeJS.ProcessEnv = process.env): ConfigOauth | null {
  const secreto = env.OAUTH_JWT_SECRET?.trim();
  const secretoValido = secreto && secreto.length >= LARGO_MINIMO_SECRETO_OAUTH ? secreto : undefined;
  const clavePublica = env.OAUTH_JWT_PUBLIC_KEY?.trim().replace(/\\n/g, '\n') || undefined;
  if (!secretoValido && !clavePublica) return null;
  return {
    secreto: secretoValido,
    clavePublica,
    emisor: env.OAUTH_ISSUER?.trim() || undefined,
    audiencia: env.OAUTH_AUDIENCE?.trim() || undefined,
    vidaMaximaS: Number(env.OAUTH_VIDA_MAX_S) > 0 ? Number(env.OAUTH_VIDA_MAX_S) : VIDA_MAXIMA_POR_DEFECTO_S,
  };
}

interface CargaOauth {
  sub?: string;
  scope?: string;
  scp?: string[] | string;
  roles?: string[];
  iat?: number;
  exp?: number;
}

export function scopesDe(carga: CargaOauth): string[] | null {
  const bruto = carga.scope ?? carga.scp;
  if (bruto === undefined) return null;
  const lista = Array.isArray(bruto) ? bruto : String(bruto).split(' ');
  return lista.filter((s) => typeof s === 'string' && s.length > 0);
}

@Injectable()
export class AutenticacionV2Service {
  private readonly jwt = new JwtService();

  constructor(private readonly auth: AuthService) {}

  async principal(req: Request): Promise<PrincipalV2> {
    const llave = req.header('x-api-key');
    if (llave !== undefined) {
      const esperada = process.env.V2_API_KEY?.trim();
      if (!esperada || esperada.length < LARGO_MINIMO_LLAVE || !igualSeguro(llave, esperada)) {
        throw new ProblemaV2Exception(401, 'UNAUTHORIZED', 'La X-API-Key no es válida.');
      }
      return { rol: 'SERVICE', via: 'apikey' };
    }
    if (!req.headers.authorization) {
      throw new ProblemaV2Exception(401, 'UNAUTHORIZED', 'Esta operación exige credenciales: Authorization: Bearer <token> o X-API-Key.');
    }
    const delEmisor = await this.tokenDelEmisor(req.headers.authorization);
    if (delEmisor) return delEmisor;
    try {
      // Fase 8.1: firma y vencimiento del token (10 minutos); no se lee la cuenta
      const usuario = await this.auth.sesionDelToken(req.headers.authorization, ahoraDelTokenDePrueba(req));
      if (usuario.rol === RolUsuario.CLIENTE) return { rol: 'CLIENTE', usuarioId: usuario.id, via: 'usuario' };
      return { rol: 'ADMIN', usuarioId: usuario.id, superadmin: usuario.rol === RolUsuario.SUPERADMIN, via: 'usuario' };
    } catch (error) {
      // Los errores de la v1 (token inválido o vencido) se traducen a los códigos del contrato
      if (error instanceof HttpException && error.getStatus() === 403) {
        throw new ProblemaV2Exception(403, 'FORBIDDEN', 'La cuenta no está activa.');
      }
      throw new ProblemaV2Exception(401, 'UNAUTHORIZED', 'El token no es válido o venció.');
    }
  }

  // null si el token no es del emisor OAuth2 (firma que no corresponde o emisor sin configurar): entonces sigue el login de Cozy
  private async tokenDelEmisor(cabecera: string): Promise<PrincipalV2 | null> {
    const config = configOauth();
    const token = /^Bearer\s+(.+)$/i.exec(cabecera)?.[1];
    if (!config || !token) return null;
    let carga: CargaOauth;
    try {
      carga = await this.jwt.verifyAsync<CargaOauth>(token, {
        ...(config.secreto ? { secret: config.secreto, algorithms: ['HS256'] } : { publicKey: config.clavePublica, algorithms: ['RS256', 'ES256'] }),
        ...(config.emisor && { issuer: config.emisor }),
        ...(config.audiencia && { audience: config.audiencia }),
        clockTolerance: 5,
      });
    } catch (error) {
      // Un token del emisor vencido es 401; uno con otra firma puede ser el login de Cozy
      if ((error as Error).name === 'TokenExpiredError') throw new ProblemaV2Exception(401, 'UNAUTHORIZED', 'El token venció.');
      return null;
    }
    if (!carga.exp || !carga.iat || carga.exp - carga.iat > config.vidaMaximaS) {
      throw new ProblemaV2Exception(401, 'UNAUTHORIZED', `El token debe vivir como máximo ${Math.round(config.vidaMaximaS / 60)} minutos.`);
    }
    const scopes = scopesDe(carga);
    if (scopes) return { rol: 'SERVICE', via: 'oauth', scopes };
    const roles = Array.isArray(carga.roles) ? carga.roles : [];
    if (typeof carga.sub === 'string' && roles.includes('ADMIN')) return { rol: 'ADMIN', usuarioId: carga.sub, superadmin: true, via: 'usuario' };
    if (typeof carga.sub === 'string' && roles.includes('CLIENTE')) return { rol: 'CLIENTE', usuarioId: carga.sub, via: 'usuario' };
    throw new ProblemaV2Exception(401, 'UNAUTHORIZED', 'El token no trae ni scope ni roles reconocidos.');
  }

  // Aplica a la credencial lo que el contrato exige de la operación: esquema admitido, scope o rol.
  autorizar(principal: PrincipalV2, requisitos: RequisitosV2): void {
    if (principal.via === 'apikey') {
      if (!requisitos.apiKey) throw new ProblemaV2Exception(403, 'FORBIDDEN', 'La X-API-Key no sirve para esta operación.');
      return;
    }
    if (principal.via === 'oauth') {
      if (!requisitos.scope) throw new ProblemaV2Exception(403, 'FORBIDDEN', 'Un token de servicio no sirve para esta operación.');
      if (!principal.scopes?.includes(requisitos.scope)) {
        throw new ProblemaV2Exception(403, 'INSUFFICIENT_SCOPE', 'El token no incluye el scope requerido.', { scopes_requeridos: [requisitos.scope] });
      }
      return;
    }
    if (!requisitos.bearer) throw new ProblemaV2Exception(403, 'FORBIDDEN', 'Un token de usuario no sirve para esta operación.');
    if (requisitos.rolesBearer && !requisitos.rolesBearer.includes(principal.rol)) {
      throw new ProblemaV2Exception(403, 'FORBIDDEN', `Esta operación requiere el rol ${requisitos.rolesBearer.join(' o ')}.`);
    }
  }
}

// Resuelve quién llama y si su credencial sirve para la operación, antes de validar el cuerpo: sin credenciales la respuesta
// es 401 y sin permiso 403, no un 400 de esquema. Deja el resultado en req.principalV2.
// Una operación sin @OperacionV2 no se atiende (falla cerrado): nadie queda protegido por olvido.
@Injectable()
export class AutenticacionV2Guard implements CanActivate {
  constructor(
    private readonly autenticacion: AutenticacionV2Service,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<Request & { principalV2?: PrincipalV2 }>();
    req.principalV2 = await this.autenticacion.principal(req);
    const operacion = this.reflector.get<string | undefined>(OPERACION_V2, contexto.getHandler());
    const requisitos = operacion ? REQUISITOS_V2[operacion] : undefined;
    if (!requisitos) throw new ProblemaV2Exception(403, 'FORBIDDEN', 'La operación no declara qué credenciales admite.');
    this.autenticacion.autorizar(req.principalV2, requisitos);
    return true;
  }
}
