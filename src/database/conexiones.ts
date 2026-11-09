import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { opcionesConexion } from './opciones-conexion';

type Entorno = Record<string, string | undefined>;

// Fase 9.0 (E1): una conexión de TypeORM por módulo, cada una con el rol de base de su módulo (usuarios, catalogo,
// disponibilidad, reservas y comun; ver 1792810000000-Fase82RolesPorModulo). La de comun es la conexión por defecto (sin
// nombre): la usan el feed, el publicador y /health. Cada módulo inyecta la suya por nombre (CONEXION.<módulo>).
//
// Las claves no viven en el repositorio: DB_CLAVE_USUARIOS, DB_CLAVE_CATALOGO, DB_CLAVE_DISPONIBILIDAD, DB_CLAVE_RESERVAS y
// DB_CLAVE_COMUN. El servidor, el puerto, la base y el SSL salen de la conexión de siempre (DATABASE_URL o DB_HOST/…, ver
// opciones-conexion.ts); solo cambian el usuario (el rol del módulo) y la clave.
//   - Ninguna DB_CLAVE_* definida: las cinco conexiones usan la conexión única de siempre (Render y otros entornos siguen igual).
//   - Las cinco definidas: cada módulo se conecta con su rol.
//   - Algunas sí y otras no: la aplicación NO arranca y dice qué variables faltan (nunca muestra valores).
// Las migraciones (data-source.ts) siguen con la conexión única: crean esquemas y otorgan permisos.
export const CONEXION = {
  usuarios: 'usuarios',
  catalogo: 'catalogo',
  disponibilidad: 'disponibilidad',
  reservas: 'reservas',
} as const;

export const MODULOS_CON_ROL = ['usuarios', 'catalogo', 'disponibilidad', 'reservas', 'comun'] as const;
export type ModuloConRol = (typeof MODULOS_CON_ROL)[number];

export const variableDeClave = (modulo: ModuloConRol): string => `DB_CLAVE_${modulo.toUpperCase()}`;

export class ConexionPorRolIncompleta extends Error {}

// true si cada módulo se conecta con su rol; false con la conexión única. Lanza ConexionPorRolIncompleta si faltan algunas.
export function conexionPorRol(env: Entorno = process.env): boolean {
  const definidas = MODULOS_CON_ROL.filter((m) => !!env[variableDeClave(m)]?.trim());
  if (definidas.length === 0) return false;
  if (definidas.length === MODULOS_CON_ROL.length) return true;
  const faltan = MODULOS_CON_ROL.filter((m) => !definidas.includes(m)).map(variableDeClave);
  throw new ConexionPorRolIncompleta(
    `Conexión por rol incompleta: falta ${faltan.join(', ')} (están definidas ${definidas.map(variableDeClave).join(', ')}). ` +
      'Define las cinco DB_CLAVE_* para que cada módulo se conecte con su rol, o ninguna para usar la conexión única.',
  );
}

// Opciones de conexión del módulo, con su rol si corresponde
export function opcionesDelModulo(modulo: ModuloConRol, env: Entorno = process.env): Pick<PostgresConnectionOptions, 'url' | 'host' | 'port' | 'username' | 'password' | 'database' | 'ssl' | 'applicationName'> {
  const base = opcionesConexion(env);
  const applicationName = `cozy-${modulo}`;
  if (!conexionPorRol(env)) return { ...base, applicationName };
  const clave = env[variableDeClave(modulo)]!;
  return conRolDelModulo(base, modulo, clave, applicationName);
}

// Fase 9.2: en el arranque por proceso separado, cada servicio solo necesita la clave de SU rol (o ninguna si todo el
// entorno usa conexión única). Si hay claves de otros módulos pero falta la de este, lanza ConexionPorRolIncompleta.
export function conexionDeUnModulo(modulo: ModuloConRol, env: Entorno = process.env): boolean {
  const propia = !!env[variableDeClave(modulo)]?.trim();
  if (propia) return true;
  const definidas = MODULOS_CON_ROL.filter((m) => !!env[variableDeClave(m)]?.trim());
  if (definidas.length === 0) return false;
  throw new ConexionPorRolIncompleta(
    `Conexión por rol incompleta para ${modulo}: falta ${variableDeClave(modulo)} (están definidas ${definidas.map(variableDeClave).join(', ')}).`,
  );
}

export function opcionesDeUnModulo(modulo: ModuloConRol, env: Entorno = process.env): Pick<PostgresConnectionOptions, 'url' | 'host' | 'port' | 'username' | 'password' | 'database' | 'ssl' | 'applicationName'> {
  const base = opcionesConexion(env);
  const applicationName = `cozy-${modulo}`;
  if (!conexionDeUnModulo(modulo, env)) return { ...base, applicationName };
  const clave = env[variableDeClave(modulo)]!;
  return conRolDelModulo(base, modulo, clave, applicationName);
}

function conRolDelModulo(
  base: Pick<PostgresConnectionOptions, 'url' | 'host' | 'port' | 'username' | 'password' | 'database' | 'ssl'>,
  modulo: ModuloConRol,
  clave: string,
  applicationName: string,
): Pick<PostgresConnectionOptions, 'url' | 'host' | 'port' | 'username' | 'password' | 'database' | 'ssl' | 'applicationName'> {
  if (base.url) {
    const u = new URL(base.url);
    return {
      host: decodeURIComponent(u.hostname),
      port: Number(u.port) || 5432,
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      username: modulo,
      password: clave,
      ssl: base.ssl,
      applicationName,
    };
  }
  return { host: base.host, port: base.port, database: base.database, username: modulo, password: clave, ssl: base.ssl, applicationName };
}
