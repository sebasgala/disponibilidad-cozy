import { createPublicKey } from 'crypto';
import { Controller, Get } from '@nestjs/common';
import { JwtModuleOptions } from '@nestjs/jwt';
import { SEGUNDOS_DE_VIGENCIA } from './auth.service';

type Entorno = Record<string, string | undefined>;

function normalizarPem(valor: string | undefined): string | undefined {
  const limpio = valor?.trim();
  if (!limpio) return undefined;
  return limpio.replace(/\\n/g, '\n');
}

export function resolverParRsaJwt(env: Entorno = process.env): { privateKey?: string; publicKey?: string } {
  const privateKey = normalizarPem(env.JWT_PRIVATE_KEY);
  let publicKey = normalizarPem(env.JWT_PUBLIC_KEY);
  if (!publicKey && privateKey) {
    publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  }
  return { privateKey, publicKey };
}

export function obtenerClavePublicaPem(env: Entorno = process.env): { algorithm: 'RS256' | 'HS256'; publicKey: string | null } {
  const { publicKey } = resolverParRsaJwt(env);
  if (publicKey) return { algorithm: 'RS256', publicKey };
  return { algorithm: 'HS256', publicKey: null };
}

// Fase 9.4 (decisión D3):
//   - Con par RSA (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY), usa RS256: solo `usuarios` firma con la clave privada;
//     el gateway y los demás servicios verifican únicamente con la clave pública.
//   - Sin par RSA, mantiene JWT_SECRET (HS256, mínimo 32 caracteres) solo para pruebas.
export function construirOpcionesJwt(
  modo: 'firmar_y_verificar' | 'solo_verificar',
  env: Entorno = process.env,
): JwtModuleOptions {
  const { privateKey, publicKey } = resolverParRsaJwt(env);
  const issuer = env.JWT_ISSUER?.trim() || undefined;
  const audience = env.JWT_AUDIENCE?.trim() || undefined;

  if (modo === 'firmar_y_verificar') {
    if (privateKey && publicKey) {
      return {
        privateKey,
        publicKey,
        signOptions: {
          algorithm: 'RS256',
          expiresIn: SEGUNDOS_DE_VIGENCIA,
          ...(issuer && { issuer }),
          ...(audience && { audience }),
        },
        verifyOptions: {
          algorithms: ['RS256'],
          ...(issuer && { issuer }),
          ...(audience && { audience }),
        },
      };
    }
    if (publicKey && !privateKey) {
      throw new Error('Falta JWT_PRIVATE_KEY en el módulo usuarios para firmar con RS256 (solo está definida JWT_PUBLIC_KEY).');
    }
  } else {
    if (publicKey) {
      // Los demás módulos y el gateway solo cargan la clave pública: nunca pueden firmar tokens.
      return {
        publicKey,
        verifyOptions: {
          algorithms: ['RS256'],
          ...(issuer && { issuer }),
          ...(audience && { audience }),
        },
      };
    }
  }

  // Respaldo con JWT_SECRET solo para pruebas cuando no hay par RSA configurado
  const secret = env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    const variableRequerida = modo === 'firmar_y_verificar' ? 'JWT_PRIVATE_KEY (RS256) o JWT_SECRET' : 'JWT_PUBLIC_KEY (RS256) o JWT_SECRET';
    throw new Error(
      `Falta ${variableRequerida} (mínimo 32 caracteres para JWT_SECRET en pruebas).`,
    );
  }

  if (modo === 'solo_verificar') {
    return {
      secret,
      verifyOptions: {
        algorithms: ['HS256'],
        ...(issuer && { issuer }),
        ...(audience && { audience }),
      },
    };
  }

  return {
    secret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: SEGUNDOS_DE_VIGENCIA,
      ...(issuer && { issuer }),
      ...(audience && { audience }),
    },
    verifyOptions: {
      algorithms: ['HS256'],
      ...(issuer && { issuer }),
      ...(audience && { audience }),
    },
  };
}

@Controller('interno/usuarios')
export class ClavePublicaJwtController {
  @Get('clave-publica')
  clavePublica() {
    return obtenerClavePublicaPem(process.env);
  }
}
