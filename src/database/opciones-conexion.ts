import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

type Entorno = Record<string, string | undefined>;

// Opciones de conexión a PostgreSQL, compartidas por la aplicación (app.module.ts) y por el CLI de
// migraciones (data-source.ts), para que ambos se conecten exactamente igual.
//
//   1. DATABASE_URL (lo normal, y lo que entrega Render): postgresql://usuario:clave@host:5432/base
//   2. Si no existe, variables sueltas: DB_HOST, DB_PORT (5432), DB_USER, DB_PASSWORD y DB_NAME.
//
// SSL: activo cuando NODE_ENV=production. DATABASE_SSL=false lo apaga (p. ej. una base en la misma red privada
// que no ofrece SSL) y DATABASE_SSL=true lo fuerza en otros entornos. Cifra la conexión pero no verifica el
// certificado del servidor (rejectUnauthorized: false), que es lo habitual con las bases administradas de Render.
export function opcionesConexion(env: Entorno = process.env): Pick<PostgresConnectionOptions, 'url' | 'host' | 'port' | 'username' | 'password' | 'database' | 'ssl'> {
  const ssl = usaSsl(env) ? { rejectUnauthorized: false } : false;

  if (env.DATABASE_URL?.trim()) return { url: env.DATABASE_URL.trim(), ssl };

  const faltan = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter((nombre) => !env[nombre]?.trim());
  if (faltan.length > 0) {
    throw new Error(`Falta la conexión a la base de datos: define DATABASE_URL, o bien ${faltan.join(', ')} (y opcionalmente DB_PORT).`);
  }
  return {
    host: env.DB_HOST.trim(),
    port: Number(env.DB_PORT) || 5432,
    username: env.DB_USER.trim(),
    password: env.DB_PASSWORD,
    database: env.DB_NAME.trim(),
    ssl,
  };
}

function usaSsl(env: Entorno): boolean {
  const explicito = env.DATABASE_SSL?.trim().toLowerCase();
  if (explicito === 'true') return true;
  if (explicito === 'false') return false;
  return env.NODE_ENV === 'production';
}
