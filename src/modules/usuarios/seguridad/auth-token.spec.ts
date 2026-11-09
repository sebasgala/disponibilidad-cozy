import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoUsuario, RolUsuario, Usuario } from '../entities/usuario.entity';
import { AuthService, SEGUNDOS_DE_VIGENCIA } from './auth.service';
import { construirOpcionesJwt } from './claves-jwt';

// Fase 8.1: el token dura 10 minutos, lleva id, rol y estado, y validarlo no lee la cuenta. Renovar sí la lee.

const ID = '3f2b8f1e-5c1d-4e0a-9d6b-0a1b2c3d4e5f';
const cuenta = (extra: Partial<Usuario> = {}): Usuario =>
  ({ id: ID, email: 'ana@prueba.test', nombre: 'Ana', apellido: 'Pérez', rol: RolUsuario.CLIENTE, estado: EstadoUsuario.ACTIVO, createdAt: new Date('2026-11-01T00:00:00Z'), ...extra }) as Usuario;

// Repositorio de mentira: cuenta cuántas veces se lo consulta
function servicio(actual: Usuario | null) {
  const lecturas = { n: 0 };
  const repo = {
    findOneBy: async () => {
      lecturas.n++;
      return actual;
    },
  };
  const jwt = new JwtService({ secret: 'secreto-de-prueba-de-al-menos-32-caracteres!!', signOptions: { expiresIn: SEGUNDOS_DE_VIGENCIA } });
  return { auth: new AuthService(repo as never, jwt), jwt, lecturas, repo };
}
const bearer = (token: string) => `Bearer ${token}`;
const estadoHttp = async (f: () => Promise<unknown>): Promise<number | string> => {
  try {
    await f();
    return 'OK';
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : `otro: ${e}`;
  }
};
const codigoDe = async (f: () => Promise<unknown>): Promise<string> => {
  try {
    await f();
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? `otro: ${e}`;
  }
};

describe('token de la cuenta (fase 8.1)', () => {
  it('dura 10 minutos y lleva el id, el rol y el estado', async () => {
    assert.equal(SEGUNDOS_DE_VIGENCIA, 600);
    const { auth, jwt } = servicio(cuenta({ rol: RolUsuario.ADMINISTRADOR }));
    const { access_token, expires_in } = await auth.renovar(ID);
    const carga = jwt.decode(access_token) as { sub: string; rol: string; estado: string; iat: number; exp: number };
    assert.equal(expires_in, 600);
    assert.equal(carga.exp - carga.iat, 600);
    assert.deepEqual([carga.sub, carga.rol, carga.estado], [ID, 'administrador', 'activo']);
  });

  it('validarlo NO lee la cuenta: la sesión sale del token', async () => {
    const { auth, lecturas } = servicio(cuenta());
    const { access_token } = await auth.renovar(ID);
    assert.equal(lecturas.n, 1); // la renovación sí la lee
    const sesion = await auth.sesionDelToken(bearer(access_token));
    assert.deepEqual(sesion, { id: ID, rol: RolUsuario.CLIENTE, estado: EstadoUsuario.ACTIVO });
    assert.equal(lecturas.n, 1); // validar no agregó ninguna lectura
  });

  it('una cuenta suspendida después de emitir el token sigue pasando hasta que el token vence', async () => {
    const activa = servicio(cuenta());
    const { access_token } = await activa.auth.renovar(ID);
    // El mismo token, validado por un servicio cuya base ya tiene la cuenta suspendida: no se entera
    const suspendida = servicio(cuenta({ estado: EstadoUsuario.SUSPENDIDO }));
    assert.equal((await suspendida.auth.sesionDelToken(bearer(access_token))).id, ID);
    assert.equal(suspendida.lecturas.n, 0);
  });

  it('al vencer deja de valer (401): el instante se puede fijar sin esperar', async () => {
    const { auth } = servicio(cuenta());
    const { access_token } = await auth.renovar(ID);
    const justoAntes = new Date(Date.now() + (SEGUNDOS_DE_VIGENCIA - 30) * 1000);
    const despues = new Date(Date.now() + (SEGUNDOS_DE_VIGENCIA + 60) * 1000);
    assert.equal(await estadoHttp(() => auth.sesionDelToken(bearer(access_token), justoAntes)), 'OK');
    assert.equal(await estadoHttp(() => auth.sesionDelToken(bearer(access_token), despues)), 401);
  });

  it('un token vencido no se renueva: JwtAuthGuard ya lo rechazó antes de llegar a renovar', async () => {
    const { auth } = servicio(cuenta());
    const { access_token } = await auth.renovar(ID);
    const despues = new Date(Date.now() + (SEGUNDOS_DE_VIGENCIA + 60) * 1000);
    assert.equal(await estadoHttp(() => auth.sesionDelToken(bearer(access_token), despues)), 401);
  });

  it('sin token, con basura o de antes de la fase 8.1 (solo sub): 401', async () => {
    const { auth, jwt } = servicio(cuenta());
    assert.equal(await estadoHttp(() => auth.sesionDelToken(undefined)), 401);
    assert.equal(await estadoHttp(() => auth.sesionDelToken('Bearer no.es.un.jwt')), 401);
    assert.equal(await estadoHttp(async () => auth.sesionDelToken(bearer(await jwt.signAsync({ sub: ID })))), 401);
    assert.equal(await estadoHttp(async () => auth.sesionDelToken(bearer(await jwt.signAsync({ sub: ID, rol: 'rey', estado: 'activo' })))), 401);
    assert.equal(await estadoHttp(async () => auth.sesionDelToken(bearer(await jwt.signAsync({ sub: 'no-es-uuid', rol: 'cliente', estado: 'activo' })))), 401);
  });

  it('un token firmado con otra clave: 401', async () => {
    const { auth } = servicio(cuenta());
    const ajeno = new JwtService({ secret: 'otra-clave-distinta-de-al-menos-32-caracteres!!' });
    const token = await ajeno.signAsync({ sub: ID, rol: 'cliente', estado: 'activo' });
    assert.equal(await estadoHttp(() => auth.sesionDelToken(bearer(token))), 401);
  });

  it('un token cuyo estado no es activo no sirve (ACCOUNT_SUSPENDED / ACCOUNT_PENDING)', async () => {
    const { auth, jwt } = servicio(cuenta());
    const suspendido = await jwt.signAsync({ sub: ID, rol: 'cliente', estado: 'suspendido' });
    const pendiente = await jwt.signAsync({ sub: ID, rol: 'administrador', estado: 'pendiente' });
    assert.equal(await codigoDe(() => auth.sesionDelToken(bearer(suspendido))), 'ACCOUNT_SUSPENDED');
    assert.equal(await codigoDe(() => auth.sesionDelToken(bearer(pendiente))), 'ACCOUNT_PENDING');
  });

  it('renovar: con la cuenta suspendida da 403 ACCOUNT_SUSPENDED y no emite token', async () => {
    const { auth } = servicio(cuenta({ estado: EstadoUsuario.SUSPENDIDO }));
    assert.equal(await estadoHttp(() => auth.renovar(ID)), 403);
    assert.equal(await codigoDe(() => auth.renovar(ID)), 'ACCOUNT_SUSPENDED');
  });

  it('renovar: el token nuevo trae el rol y el estado de ahora (un cambio de rol se nota aquí)', async () => {
    const { auth, jwt } = servicio(cuenta({ rol: RolUsuario.ADMINISTRADOR }));
    const nuevo = await auth.renovar(ID);
    assert.equal((jwt.decode(nuevo.access_token) as { rol: string }).rol, 'administrador');
    assert.equal(nuevo.usuario.rol, RolUsuario.ADMINISTRADOR);
  });

  it('renovar: una cuenta que ya no existe da 401', async () => {
    const { auth } = servicio(null);
    assert.equal(await estadoHttp(() => auth.renovar(ID)), 401);
  });

  it('RS256 (fase 9.4, D3): usuarios firma con la clave privada y los demás verifican solo con la pública', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const optsFirmador = construirOpcionesJwt('firmar_y_verificar', { JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });
    const optsVerificador = construirOpcionesJwt('solo_verificar', { JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });
    assert.equal(optsVerificador.privateKey, undefined);
    assert.equal(optsVerificador.secret, undefined);

    const jwtUsuarios = new JwtService(optsFirmador);
    const jwtOtroModulo = new JwtService(optsVerificador);
    const authUsuarios = new AuthService({ findOneBy: async () => cuenta({ rol: RolUsuario.ADMINISTRADOR }) } as never, jwtUsuarios);
    const authOtroModulo = new AuthService(undefined, jwtOtroModulo);

    const { access_token } = await authUsuarios.renovar(ID);
    const cabeceraJwt = JSON.parse(Buffer.from(access_token.split('.')[0], 'base64url').toString('utf8')) as { alg: string };
    assert.equal(cabeceraJwt.alg, 'RS256');

    const sesion = await authOtroModulo.sesionDelToken(bearer(access_token));
    assert.deepEqual(sesion, { id: ID, rol: RolUsuario.ADMINISTRADOR, estado: EstadoUsuario.ACTIVO });

    // Un módulo que solo verifica no tiene clave privada y no puede emitir tokens
    await assert.rejects(() => jwtOtroModulo.signAsync({ sub: ID, rol: 'cliente', estado: 'activo' }));
  });
});
