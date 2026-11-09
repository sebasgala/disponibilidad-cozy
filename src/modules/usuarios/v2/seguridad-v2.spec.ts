import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JwtService } from '@nestjs/jwt';
import { load } from 'js-yaml';
import { AutenticacionV2Service, PrincipalV2, scopesDe } from './autenticacion-v2';
import { ProblemaV2Exception } from '../../comun/v2/problemas-v2';
import { REQUISITOS_V2 } from './seguridad-v2';

// Se corre desde backend/ (npm test)
const contrato = load(readFileSync(resolve(process.cwd(), 'contracts/v2/alojamientos-openapi-v2.yaml'), 'utf8')) as {
  security: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, { operationId?: string; security?: Array<Record<string, string[]>>; 'x-required-roles'?: string[] }>>;
  components: { securitySchemes: { OAuth2ClientCredentials: { flows: { clientCredentials: { scopes: Record<string, string> } } } } };
};
const operaciones = Object.entries(contrato.paths).flatMap(([ruta, metodos]) =>
  Object.entries(metodos)
    .filter(([m]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
    .map(([metodo, op]) => ({ ruta, metodo, id: op.operationId as string, seguridad: op.security ?? contrato.security, roles: op['x-required-roles'] })),
);

test('REQUISITOS_V2 coincide con el `security` de cada operación del contrato', () => {
  for (const op of operaciones) {
    const publica = op.seguridad.length === 0;
    const req = REQUISITOS_V2[op.id];
    if (publica) {
      assert.equal(req, undefined, `${op.id} es pública en el contrato y no debe estar en la tabla`);
      continue;
    }
    assert.ok(req, `${op.id} no está en REQUISITOS_V2`);
    const oauth = op.seguridad.find((s) => 'OAuth2ClientCredentials' in s)?.OAuth2ClientCredentials;
    assert.equal(req.scope, oauth?.[0], `${op.id}: scope`);
    assert.equal(req.bearer, op.seguridad.some((s) => 'BearerAuth' in s), `${op.id}: BearerAuth`);
    assert.equal(req.apiKey, op.seguridad.some((s) => 'ApiKeyAuth' in s), `${op.id}: ApiKeyAuth`);
    // x-required-roles: los roles de usuario que admite el Bearer (SERVICE no es un rol de usuario)
    const rolesUsuario = op.roles?.filter((r) => r !== 'SERVICE');
    if (req.bearer) assert.deepEqual(req.rolesBearer, rolesUsuario, `${op.id}: roles`);
  }
  for (const id of Object.keys(REQUISITOS_V2)) assert.ok(operaciones.some((o) => o.id === id), `${id} sobra: no existe en el contrato`);
});

test('Los scopes usados existen en el flujo client_credentials del contrato', () => {
  const declarados = Object.keys(contrato.components.securitySchemes.OAuth2ClientCredentials.flows.clientCredentials.scopes);
  for (const [id, req] of Object.entries(REQUISITOS_V2)) if (req.scope) assert.ok(declarados.includes(req.scope), `${id}: scope ${req.scope} no declarado`);
});

test('No hay mutaciones anónimas: solo search y quote (lecturas por POST) son públicas', () => {
  const anonimasQueMutan = operaciones.filter((o) => o.metodo !== 'get' && o.seguridad.length === 0).map((o) => o.id);
  assert.deepEqual(anonimasQueMutan.sort(), ['quoteAvailability', 'searchAlojamientos']);
  for (const o of operaciones.filter((o) => o.metodo !== 'get' && o.seguridad.length > 0)) assert.ok(REQUISITOS_V2[o.id], `${o.id} sin requisitos`);
});

const servicio = new AutenticacionV2Service({
  sesionDelToken: async () => {
    throw new Error('no es un token de Cozy');
  },
} as never);
const oauth = (scopes: string[]): PrincipalV2 => ({ rol: 'SERVICE', via: 'oauth', scopes });

test('Token sin el scope requerido => 403 INSUFFICIENT_SCOPE con scopes_requeridos', () => {
  assert.throws(
    () => servicio.autorizar(oauth(['alojamientos:read']), REQUISITOS_V2.cancelOrder),
    (e: ProblemaV2Exception) => e.estado === 403 && e.codigo === 'INSUFFICIENT_SCOPE' && e.extras.scopes_requeridos?.[0] === 'alojamientos:cancel',
  );
  assert.doesNotThrow(() => servicio.autorizar(oauth(['alojamientos:cancel']), REQUISITOS_V2.cancelOrder));
  // sin ningún scope
  assert.throws(() => servicio.autorizar(oauth([]), REQUISITOS_V2.createOrder), (e: ProblemaV2Exception) => e.codigo === 'INSUFFICIENT_SCOPE');
});

test('La llave heredada y los tokens de usuario solo valen donde el contrato los lista', () => {
  const llave: PrincipalV2 = { rol: 'SERVICE', via: 'apikey' };
  assert.doesNotThrow(() => servicio.autorizar(llave, REQUISITOS_V2.createOrder));
  assert.throws(() => servicio.autorizar(llave, REQUISITOS_V2.checkInOrder), (e: ProblemaV2Exception) => e.estado === 403 && e.codigo === 'FORBIDDEN');
  const cliente: PrincipalV2 = { rol: 'CLIENTE', via: 'usuario', usuarioId: 'u1' };
  assert.doesNotThrow(() => servicio.autorizar(cliente, REQUISITOS_V2.createOrder));
  assert.throws(() => servicio.autorizar(cliente, REQUISITOS_V2.listOrders), (e: ProblemaV2Exception) => e.codigo === 'FORBIDDEN');
  assert.throws(() => servicio.autorizar(cliente, REQUISITOS_V2.getInventorySnapshot), (e: ProblemaV2Exception) => e.codigo === 'FORBIDDEN');
  // un token de máquina no sirve donde solo hay BearerAuth
  assert.throws(() => servicio.autorizar(oauth(['alojamientos:read']), REQUISITOS_V2.listMyReservations), (e: ProblemaV2Exception) => e.codigo === 'FORBIDDEN');
});

test('scopesDe lee scope (texto) y scp (lista)', () => {
  assert.deepEqual(scopesDe({ scope: 'alojamientos:read alojamientos:book' }), ['alojamientos:read', 'alojamientos:book']);
  assert.deepEqual(scopesDe({ scp: ['alojamientos:read'] }), ['alojamientos:read']);
  assert.equal(scopesDe({}), null);
});

// ── Verificación del token del emisor ──
const SECRETO = 'secreto-de-prueba-oauth-con-mas-de-32-caracteres';
const firmar = (carga: object, opciones: Record<string, unknown> = {}, secreto = SECRETO) =>
  new JwtService().sign({ ...carga }, { secret: secreto, algorithm: 'HS256', ...opciones });
const pedir = (token: string) => servicio.principal({ header: () => undefined, headers: { authorization: `Bearer ${token}` } } as never);
const rechazo = (estado: number) => (e: unknown) => e instanceof ProblemaV2Exception && e.estado === estado;

test('Token OAuth2: se acepta con firma y vida válidas; si no, 401', async () => {
  process.env.OAUTH_JWT_SECRET = SECRETO;
  try {
    const ok = await pedir(firmar({ scope: 'alojamientos:read alojamientos:book' }, { expiresIn: 600 }));
    assert.equal(ok.via, 'oauth');
    assert.deepEqual(ok.scopes, ['alojamientos:read', 'alojamientos:book']);
    // vive más de 15 minutos
    await assert.rejects(pedir(firmar({ scope: 'alojamientos:read' }, { expiresIn: 3600 })), rechazo(401));
    // vencido
    const ahora = Math.floor(Date.now() / 1000);
    await assert.rejects(pedir(firmar({ scope: 'alojamientos:read', iat: ahora - 1000, exp: ahora - 500 })), rechazo(401));
    // otra firma: se trata como token de Cozy, que no lo reconoce
    await assert.rejects(pedir(firmar({ scope: 'alojamientos:read' }, { expiresIn: 600 }, 'otro-secreto-distinto-de-mas-de-32-caracteres')), rechazo(401));
    // sin scope ni roles
    await assert.rejects(pedir(firmar({ sub: 'x' }, { expiresIn: 600 })), rechazo(401));
    // alg none
    const sinFirma = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ scope: 'alojamientos:admin', exp: ahora + 300, iat: ahora })).toString('base64url')}.`;
    await assert.rejects(pedir(sinFirma), rechazo(401));
    // roles de usuario (sin scope)
    assert.equal((await pedir(firmar({ sub: 'u-externo', roles: ['CLIENTE'] }, { expiresIn: 600 }))).rol, 'CLIENTE');
  } finally {
    delete process.env.OAUTH_JWT_SECRET;
  }
});

test('Con emisor y audiencia configurados, el token debe traerlos', async () => {
  process.env.OAUTH_JWT_SECRET = SECRETO;
  process.env.OAUTH_ISSUER = 'https://emisor.test';
  process.env.OAUTH_AUDIENCE = 'alojamientos';
  try {
    assert.equal((await pedir(firmar({ scope: 'alojamientos:read' }, { expiresIn: 600, issuer: 'https://emisor.test', audience: 'alojamientos' }))).via, 'oauth');
    await assert.rejects(pedir(firmar({ scope: 'alojamientos:read' }, { expiresIn: 600 })), rechazo(401));
    await assert.rejects(pedir(firmar({ scope: 'alojamientos:read' }, { expiresIn: 600, issuer: 'https://otro.test', audience: 'alojamientos' })), rechazo(401));
  } finally {
    delete process.env.OAUTH_JWT_SECRET;
    delete process.env.OAUTH_ISSUER;
    delete process.env.OAUTH_AUDIENCE;
  }
});

test('Sin clave OAuth configurada no se acepta ningún token OAuth2', async () => {
  delete process.env.OAUTH_JWT_SECRET;
  await assert.rejects(pedir(firmar({ scope: 'alojamientos:admin' }, { expiresIn: 600 })), rechazo(401));
});
