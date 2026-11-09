import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Publicador del feed de eventos (fase 8, opción A). Es el ÚNICO que escribe `sequence`: lee lo pendiente de las cuatro
// outbox de dominio, lo numera a continuación del último publicado y lo copia a feed_eventos. Cada pasada es una
// transacción con dos sentencias:
//   1. SQL_CANDADO toma la fila de feed_publicador con SKIP LOCKED: si otra instancia está publicando, esta no hace nada.
//   2. SQL_PUBLICAR, una sola sentencia (una sola foto de la base, tomada DESPUÉS del candado, así ve todo lo que publicó
//      la pasada anterior): lee lo pendiente, lo numera, lo inserta en el feed, marca cada fila en su outbox y sube
//      `ultimo`. Si algo se cae antes del commit no queda nada: ni feed, ni marcas, ni contador. Sin huecos ni duplicados.
// Orden: por registradoEn (clock_timestamp() de cada fila). Una transacción que empezó después del commit de otra tiene un
// registradoEn mayor, y como la lectura es una sola foto, nunca sale antes que ella (el check-in precede al check-out).
// Esta clase y EventosService.emitir son las excepciones declaradas en scripts/verificar-fronteras.mjs.

export const LOTE_PUBLICACION = 500;
const INTERVALO_MS = 200;

// Fase 9.4: exactamente un publicador del feed corre a la vez. Sin un valor explícito el proceso no arranca.
export type PublicadorActivo = 'monolito' | 'event-bus';

export function resolverPublicadorActivo(env: NodeJS.ProcessEnv = process.env): PublicadorActivo {
  const valor = env.PUBLICADOR_ACTIVO;
  if (valor === 'monolito' || valor === 'event-bus') return valor;
  const recibido = valor === undefined ? 'sin definir' : JSON.stringify(valor);
  throw new Error(`PUBLICADOR_ACTIVO debe ser 'monolito' o 'event-bus' (recibido: ${recibido}). Solo uno de los dos publica el feed.`);
}

export const SQL_CANDADO = `SELECT "ultimo"::bigint AS "ultimo" FROM "comun"."feed_publicador" WHERE "id" = 1 FOR UPDATE SKIP LOCKED`;

const COLUMNAS = `"id", "eventoId", "tipo", "sujeto", "alojamientoId", "correlacionId", "datos", "creadoEn", "registradoEn"`;

// $1 = cuántos como máximo, $2 = el `ultimo` leído con el candado
export const SQL_PUBLICAR = `
WITH pendientes AS (
  SELECT * FROM (
    SELECT 'usuarios'::text AS "origen", ${COLUMNAS} FROM "usuarios"."outbox_usuarios" WHERE "sequence" IS NULL
    UNION ALL SELECT 'catalogo'::text, ${COLUMNAS} FROM "catalogo"."outbox_catalogo" WHERE "sequence" IS NULL
    UNION ALL SELECT 'disponibilidad'::text, ${COLUMNAS} FROM "disponibilidad"."outbox_disponibilidad" WHERE "sequence" IS NULL
    UNION ALL SELECT 'reservas'::text, ${COLUMNAS} FROM "reservas"."outbox_reservas" WHERE "sequence" IS NULL
  ) u
  ORDER BY "registradoEn", "origen", "id"
  LIMIT $1
),
numerados AS (
  SELECT p.*, $2::bigint + row_number() OVER (ORDER BY p."registradoEn", p."origen", p."id") AS "nuevo" FROM pendientes p
),
al_feed AS (
  INSERT INTO "comun"."feed_eventos" ("sequence", "id", "tipo", "sujeto", "alojamientoId", "correlacionId", "datos", "creadoEn")
  SELECT "nuevo", "eventoId", "tipo", "sujeto", "alojamientoId", "correlacionId", "datos", "creadoEn" FROM numerados
  RETURNING "sequence"
),
m_usuarios AS (UPDATE "usuarios"."outbox_usuarios" o SET "sequence" = n."nuevo" FROM numerados n WHERE n."origen" = 'usuarios' AND o."id" = n."id" RETURNING 1),
m_catalogo AS (UPDATE "catalogo"."outbox_catalogo" o SET "sequence" = n."nuevo" FROM numerados n WHERE n."origen" = 'catalogo' AND o."id" = n."id" RETURNING 1),
m_disponibilidad AS (UPDATE "disponibilidad"."outbox_disponibilidad" o SET "sequence" = n."nuevo" FROM numerados n WHERE n."origen" = 'disponibilidad' AND o."id" = n."id" RETURNING 1),
m_reservas AS (UPDATE "reservas"."outbox_reservas" o SET "sequence" = n."nuevo" FROM numerados n WHERE n."origen" = 'reservas' AND o."id" = n."id" RETURNING 1),
contador AS (UPDATE "comun"."feed_publicador" SET "ultimo" = "ultimo" + (SELECT count(*) FROM numerados) WHERE "id" = 1 RETURNING "ultimo")
SELECT (SELECT count(*) FROM al_feed)::int AS "publicados",
       ((SELECT count(*) FROM m_usuarios) + (SELECT count(*) FROM m_catalogo) + (SELECT count(*) FROM m_disponibilidad) + (SELECT count(*) FROM m_reservas))::int AS "marcados",
       (SELECT "ultimo" FROM contador)::bigint AS "ultimo"
`;

export const SQL_PENDIENTES = `
SELECT ((SELECT count(*) FROM "usuarios"."outbox_usuarios" WHERE "sequence" IS NULL)
      + (SELECT count(*) FROM "catalogo"."outbox_catalogo" WHERE "sequence" IS NULL)
      + (SELECT count(*) FROM "disponibilidad"."outbox_disponibilidad" WHERE "sequence" IS NULL)
      + (SELECT count(*) FROM "reservas"."outbox_reservas" WHERE "sequence" IS NULL))::int AS "pendientes"
`;

@Injectable()
export class PublicadorEventosService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('PublicadorEventos');
  private temporizador?: NodeJS.Timeout;
  private enCurso: Promise<void> | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    if (resolverPublicadorActivo() !== 'monolito') {
      this.log.log('Publicador del monolito inactivo: PUBLICADOR_ACTIVO=event-bus.');
      return;
    }
    this.temporizador = setInterval(() => void this.pasada(), INTERVALO_MS);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.temporizador);
    await this.enCurso;
  }

  // Una pasada publica lotes hasta vaciar las outbox; si la anterior sigue en curso, no se encima
  private pasada(): Promise<void> {
    this.enCurso ??= (async () => {
      try {
        while ((await this.publicarLote()) === LOTE_PUBLICACION);
      } catch (e) {
        this.log.error(`No se pudo publicar eventos: ${(e as Error).message}`);
      } finally {
        this.enCurso = null;
      }
    })();
    return this.enCurso;
  }

  // Publica a lo sumo `lote` eventos y devuelve cuántos. 0 si no había nada o si otra instancia tiene el candado.
  async publicarLote(lote = LOTE_PUBLICACION): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const [candado] = await manager.query(SQL_CANDADO);
      if (!candado) return 0;
      const [r] = await manager.query(SQL_PUBLICAR, [lote, candado.ultimo]);
      if (r.marcados !== r.publicados || Number(r.ultimo) !== Number(candado.ultimo) + r.publicados) {
        throw new Error(`publicación inconsistente: ${r.publicados} al feed, ${r.marcados} marcados, último ${r.ultimo} (antes ${candado.ultimo})`);
      }
      return r.publicados;
    });
  }

  // Eventos confirmados por los dominios que el feed todavía no muestra
  async pendientes(): Promise<number> {
    const [fila] = await this.dataSource.query(SQL_PENDIENTES);
    return fila.pendientes;
  }
}
