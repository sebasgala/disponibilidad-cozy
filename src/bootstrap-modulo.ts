import { Logger, RequestMethod, Type, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { opcionesCors, valorTrustProxy } from './config/red';
import { opcionesHttps } from './config/tls';
import { CONEXION, conexionDeUnModulo, ModuloConRol, opcionesDeUnModulo } from './database/conexiones';
import { RutasV2Filter } from './modules/comun/v2/problemas-v2';
import { LoggerConCorrelacion, middlewareCorrelacion, middlewareRegistroV2 } from './modules/comun/v2/registro-v2';
import { middlewareHttpsV2, middlewareV2 } from './modules/comun/v2/transversal-v2';

const VARIABLES_DE_CONEXION = [
  'DATABASE_URL',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'DATABASE_SSL',
  'NODE_ENV',
  'DB_CLAVE_USUARIOS',
  'DB_CLAVE_CATALOGO',
  'DB_CLAVE_DISPONIBILIDAD',
  'DB_CLAVE_RESERVAS',
  'DB_CLAVE_COMUN',
];

// Registra únicamente la conexión de base de datos del módulo que arranca en este proceso (fase 9.2).
export function conexionUnicaModulo(modulo: ModuloConRol) {
  const nombre = modulo === 'comun' ? undefined : CONEXION[modulo];
  return TypeOrmModule.forRootAsync({
    name: nombre,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => ({
      type: 'postgres' as const,
      ...(nombre ? { name: nombre } : {}),
      ...opcionesDeUnModulo(modulo, Object.fromEntries(VARIABLES_DE_CONEXION.map((v) => [v, configService.get<string>(v)]))),
      autoLoadEntities: true,
      synchronize: false,
    }),
  });
}

async function comprobarRolDelModulo(app: NestExpressApplication, modulo: ModuloConRol): Promise<void> {
  const log = new Logger(`ConexionPorRol:${modulo}`);
  const porRol = conexionDeUnModulo(modulo, process.env);
  const token = modulo === 'comun' ? getDataSourceToken() : getDataSourceToken(CONEXION[modulo]);
  const ds = app.get<DataSource>(token);
  const [{ rol }] = await ds.query<[{ rol: string }]>('SELECT current_user AS rol');
  if (porRol && rol !== modulo) {
    throw new Error(`La conexión del módulo ${modulo} abrió sesión como ${rol}, no como ${modulo}`);
  }
  log.log(
    porRol
      ? `Conexión con su rol de base (${modulo}=${rol})`
      : `Sin DB_CLAVE_*: conexión con el usuario general (${rol}).`,
  );
}

export async function arrancarModulo(opciones: {
  modulo: ModuloConRol;
  puertoPorDefecto: number;
  variablePuerto: string;
  AppModulo: Type<unknown>;
}): Promise<void> {
  const { modulo, puertoPorDefecto, variablePuerto, AppModulo } = opciones;
  const app = await NestFactory.create<NestExpressApplication>(AppModulo, {
    httpsOptions: opcionesHttps(),
    logger: new LoggerConCorrelacion(),
  });
  await comprobarRolDelModulo(app, modulo);

  // GET /health queda en la raíz sin prefijo (/health, VERSION_NEUTRAL); el resto conserva /api/v1 y /api/v2.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.use(middlewareCorrelacion(modulo));
  app.use('/api/v2', middlewareRegistroV2());
  app.use('/api/v2', middlewareV2());
  app.use('/api/v2', middlewareHttpsV2());
  app.useGlobalFilters(new RutasV2Filter(app.get(HttpAdapterHost).httpAdapter));

  app.set('trust proxy', valorTrustProxy());
  app.enableCors(opcionesCors());
  app.enableShutdownHooks();

  const port = Number(process.env[variablePuerto] || process.env.PORT || puertoPorDefecto);
  await app.listen(port);
  new Logger(`Bootstrap:${modulo}`).log(`Módulo ${modulo} corriendo en: http://localhost:${port} (salud: http://localhost:${port}/health)`);
}
