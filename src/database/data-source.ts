import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { opcionesConexion } from './opciones-conexion';

// Data source para el CLI de TypeORM (migration:generate, migration:run y migration:revert).
// Se usa ya compilado (dist/database/data-source.js): los scripts de package.json hacen `nest build` antes.
// Lee la conexión del entorno o del archivo .env (dotenv no pisa una variable que ya existe): DATABASE_URL, o
// DB_HOST/DB_USER/..., con SSL en producción. Es la misma que usa la aplicación (opciones-conexion.ts).
//
// Solo entran las entidades de alojamientos (un dominio por carpeta desde la fase 8): los módulos de autos,
// atracciones y vuelos no están activos.
export default new DataSource({
  type: 'postgres',
  ...opcionesConexion(),
  entities: [join(__dirname, '..', 'modules', '{usuarios,catalogo,disponibilidad,reservas,comun}', 'entities', '*.entity.{ts,js}')],
  // Solo .js: en dist también hay .d.ts y no son migraciones.
  migrations: [join(__dirname, 'migrations', '*.js')],
  migrationsTableName: 'migraciones',
  synchronize: false,
});
