import { existsSync } from 'fs';
import { resolve } from 'path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { DataSource } from 'typeorm';
import { credencialesGrpcTls } from '../../../config/tls';
import { CatalogoPuerto } from '../../catalogo/catalogo.puerto';
import { AckStock, clasificarAck, construirMensaje, esperaReintento, EstadoNoche, MensajeStock, RelojMonotono } from './stock-envio';
import { CONEXION } from '../../../database/conexiones';

// Envía el stock a Booking por gRPC (inventory.InventoryStockService.PushStockUpdate) leyendo la tabla outbox_stock.
//
// Garantías:
//   - Fuera de la transacción de la reserva: un fallo de gRPC (caído, lento, rechazo) nunca bloquea ni deshace una reserva.
//   - Al menos una vez: la fila sigue PENDIENTE hasta que Booking acepta el mensaje; se reintenta con espera exponencial.
//   - Un mensaje por noche con available_units ABSOLUTO leído en el momento del envío (no el del evento), así un reintento
//     tardío nunca manda un dato viejo.
//   - Sin bloqueos largos: el proceso reserva las filas con un arrendamiento corto (enviandoHasta) y no las bloquea durante la
//     llamada de red. Varias instancias pueden correr a la vez (FOR UPDATE SKIP LOCKED).
//   - Si mientras se enviaba otro cambio tocó la misma noche (version distinta), la fila sigue pendiente y se vuelve a enviar.
//
// Configuración (variables de entorno). Sin BOOKING_GRPC_URL el envío queda apagado y las filas se acumulan en la outbox.
//   BOOKING_GRPC_URL              host:puerto del servidor de ingesta de Booking (puerto 50051). SIN CONFIRMAR: ver docs/integracion-v2
//   BOOKING_GRPC_TLS              true = canal TLS; cualquier otro valor = sin TLS (solo desarrollo)
//   BOOKING_SERVICE_ID            service_id de los mensajes (por defecto "alojamientos")
//   INVENTORY_PROTO               ruta de inventory.proto (por defecto contracts/v2/inventory.proto)
//   STOCK_OUTBOX_INTERVALO_MS     cada cuánto se revisa la outbox (2000)
//   STOCK_OUTBOX_TIMEOUT_MS       plazo de cada llamada (3000)
//   STOCK_OUTBOX_BACKOFF_BASE_MS  primera espera de reintento (1000); luego se duplica
//   STOCK_OUTBOX_BACKOFF_MAX_MS   tope de la espera (300000)

const LOTE = 50;
const ARRENDAMIENTO_S = 30;

interface FilaPendiente {
  id: string;
  habitacionId: string;
  fecha: string;
  version: number;
  intentos: number;
}

export interface ConfigEnvio {
  url: string;
  tls: boolean;
  serviceId: string;
  intervaloMs: number;
  timeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export function configEnvio(env: Record<string, string | undefined> = process.env): ConfigEnvio | null {
  const url = env.BOOKING_GRPC_URL?.trim();
  if (!url) return null;
  const numero = (valor: string | undefined, porDefecto: number) => (Number(valor) > 0 ? Number(valor) : porDefecto);
  return {
    url,
    tls: env.BOOKING_GRPC_TLS?.trim().toLowerCase() === 'true',
    serviceId: env.BOOKING_SERVICE_ID?.trim() || 'alojamientos',
    intervaloMs: numero(env.STOCK_OUTBOX_INTERVALO_MS, 2000),
    timeoutMs: numero(env.STOCK_OUTBOX_TIMEOUT_MS, 3000),
    backoffBaseMs: numero(env.STOCK_OUTBOX_BACKOFF_BASE_MS, 1000),
    backoffMaxMs: numero(env.STOCK_OUTBOX_BACKOFF_MAX_MS, 300_000),
  };
}

// Ruta de inventory.proto: junto a dist/ (en la imagen) o en backend/contracts/v2 (en desarrollo)
function rutaProto(): string {
  const ruta = process.env.INVENTORY_PROTO?.trim() || resolve(__dirname, '..', '..', '..', '..', 'contracts', 'v2', 'inventory.proto');
  if (!existsSync(ruta)) throw new Error(`No se encontró inventory.proto en ${ruta}. Define INVENTORY_PROTO.`);
  return ruta;
}

@Injectable()
export class StockEnvioWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('StockEnvio');
  private config: ConfigEnvio | null = null;
  private cliente: grpc.Client & { PushStockUpdate: (m: MensajeStock, o: grpc.CallOptions, cb: (e: grpc.ServiceError | null, a: AckStock) => void) => void };
  private temporizador: NodeJS.Timeout | null = null;
  private activo: Promise<void> | null = null;
  private readonly reloj = new RelojMonotono();
  private ultimoError: string | null = null;

  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly catalogo: CatalogoPuerto,
  ) {}

  onModuleInit(): void {
    this.config = configEnvio();
    if (!this.config) {
      this.log.log('BOOKING_GRPC_URL no está definida: el aviso de stock a Booking queda apagado (las filas se acumulan en outbox_stock).');
      return;
    }
    const definicion = protoLoader.loadSync(rutaProto(), { keepCase: true, longs: Number, defaults: true, oneofs: true });
    const paquete = grpc.loadPackageDefinition(definicion) as unknown as { inventory: { InventoryStockService: new (url: string, c: grpc.ChannelCredentials) => typeof this.cliente } };
    this.cliente = new paquete.inventory.InventoryStockService(this.config.url, this.config.tls ? credencialesGrpcTls() : grpc.credentials.createInsecure());
    this.log.log(`Aviso de stock a Booking activo: ${this.config.url} (${this.config.tls ? 'TLS' : 'sin TLS'}), service_id=${this.config.serviceId}`);
    this.temporizador = setInterval(() => void this.ciclo(), this.config.intervaloMs);
    this.temporizador.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.activo?.catch(() => undefined);
    this.cliente?.close();
  }

  estado() {
    return { activo: this.config !== null, destino: this.config?.url ?? null, tls: this.config?.tls ?? null, serviceId: this.config?.serviceId ?? null, ultimoError: this.ultimoError };
  }

  // Un ciclo a la vez en este proceso
  private ciclo(): Promise<void> {
    if (this.activo) return this.activo;
    this.activo = this.procesarLote()
      .then(() => undefined)
      .catch((error) => this.log.error(`Ciclo de envío con error: ${(error as Error).message}`))
      .finally(() => {
        this.activo = null;
      });
    return this.activo;
  }

  // Procesa las filas vencidas. Devuelve cuántas se enviaron (para las pruebas).
  async procesarLote(): Promise<number> {
    const config = this.config;
    if (!config) return 0;
    const filas = await this.reservar();
    if (filas.length === 0) return 0;

    const estados = await this.estados(filas);
    let enviadas = 0;
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const estado = estados.get(`${fila.habitacionId}|${fila.fecha}`);
      if (!estado) {
        await this.cerrar(fila, 'RECHAZADO', null, 'La noche ya no tiene inventario');
        continue;
      }
      const mensaje = construirMensaje(estado, config.serviceId, this.reloj.siguiente(Date.now()));
      let resultado: 'ENVIADO' | 'RECHAZADO' | 'REINTENTAR';
      let detalle = '';
      try {
        const ack = await this.enviar(mensaje, config.timeoutMs);
        resultado = clasificarAck(ack);
        detalle = `${ack.error_code || ''} ${ack.message || ''}`.trim();
      } catch (error) {
        resultado = 'REINTENTAR';
        detalle = (error as Error).message;
        // Booking no contesta: todo el lote espera junto (misma espera creciente) en vez de probar fila por fila
        for (const pendiente of filas.slice(i)) await this.reprogramar(pendiente, detalle, config);
        this.ultimoError = detalle;
        return enviadas;
      }
      if (resultado === 'ENVIADO') {
        await this.cerrar(fila, 'ENVIADO', mensaje.available_units, null);
        enviadas++;
        this.ultimoError = null;
      } else if (resultado === 'RECHAZADO') {
        await this.cerrar(fila, 'RECHAZADO', mensaje.available_units, detalle);
        this.ultimoError = detalle;
      } else {
        await this.reprogramar(fila, detalle, config);
        this.ultimoError = detalle;
      }
    }
    return enviadas;
  }

  // Reserva un lote con arrendamiento corto. No deja la fila bloqueada durante la llamada de red.
  private async reservar(): Promise<FilaPendiente[]> {
    const r = await this.dataSource.query(
      `UPDATE "disponibilidad"."outbox_stock" o SET "enviandoHasta" = now() + make_interval(secs => $1)
       WHERE o."id" IN (
         SELECT "id" FROM "disponibilidad"."outbox_stock"
         WHERE "estado" = 'PENDIENTE' AND "proximoIntentoEn" <= now() AND ("enviandoHasta" IS NULL OR "enviandoHasta" < now())
         ORDER BY "creadoEn", "id" LIMIT ${LOTE} FOR UPDATE SKIP LOCKED)
       RETURNING o."id", o."habitacionId", o."fecha"::text AS "fecha", o."version", o."intentos"`,
      [ARRENDAMIENTO_S],
    );
    const filas: FilaPendiente[] = Array.isArray(r[0]) ? r[0] : r;
    return filas.sort((a, b) => Number(a.id) - Number(b.id));
  }

  // Estado actual de cada (habitación, noche): de ahí sale el available_units absoluto
  private async estados(filas: FilaPendiente[]): Promise<Map<string, EstadoNoche>> {
    const noches: { habitacionId: string; fecha: string; cupos: number }[] = await this.dataSource.query(
      `SELECT d."habitacionId", d."fecha"::text AS "fecha", d."cupos"
       FROM unnest($1::uuid[], $2::date[]) AS k("hid", "f")
       JOIN "disponibilidad"."disponibilidad_diaria" d ON d."habitacionId" = k."hid" AND d."fecha" = k."f"`,
      [filas.map((f) => f.habitacionId), filas.map((f) => f.fecha)],
    );
    // Códigos y estado de cada habitación y su alojamiento: del catálogo
    const habitaciones = await this.catalogo.habitacionesPorIds(noches.map((n) => n.habitacionId));
    const resultado = new Map<string, EstadoNoche>();
    for (const n of noches) {
      const h = habitaciones.get(n.habitacionId);
      if (!h) continue;
      resultado.set(`${n.habitacionId}|${n.fecha}`, {
        fecha: n.fecha,
        cupos: n.cupos,
        habitacionActiva: h.activo,
        alojamientoActivo: h.alojamientoActivo,
        habitacionCodigo: h.codigo,
        alojamientoCodigo: h.alojamientoCodigo,
        checkInDesde: h.alojamientoCheckInDesde,
      });
    }
    return resultado;
  }

  private enviar(mensaje: MensajeStock, timeoutMs: number): Promise<AckStock> {
    return new Promise((resolver, rechazar) => {
      this.cliente.PushStockUpdate(mensaje, { deadline: Date.now() + timeoutMs }, (error, ack) => (error ? rechazar(new Error(`gRPC ${grpc.status[error.code] ?? error.code}: ${error.details || error.message}`)) : resolver(ack)));
    });
  }

  // Cierra la fila. Solo si nadie la tocó mientras se enviaba (misma version); si no, sigue pendiente y se vuelve a enviar.
  private async cerrar(fila: FilaPendiente, estado: 'ENVIADO' | 'RECHAZADO', unidades: number | null, error: string | null): Promise<void> {
    const r = await this.dataSource.query(
      `UPDATE "disponibilidad"."outbox_stock" SET "estado" = $2, "enviadoEn" = now(), "enviandoHasta" = NULL, "unidadesEnviadas" = $3, "ultimoError" = $4
       WHERE "id" = $1 AND "estado" = 'PENDIENTE' AND "version" = $5`,
      [fila.id, estado, unidades, error?.slice(0, 300) ?? null, fila.version],
    );
    const afectadas = Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 1;
    if (afectadas === 0) await this.dataSource.query(`UPDATE "disponibilidad"."outbox_stock" SET "enviandoHasta" = NULL, "proximoIntentoEn" = now() WHERE "id" = $1 AND "estado" = 'PENDIENTE'`, [fila.id]);
  }

  private async reprogramar(fila: FilaPendiente, error: string, config: ConfigEnvio): Promise<void> {
    const intentos = fila.intentos + 1;
    const espera = esperaReintento(intentos, config.backoffBaseMs, config.backoffMaxMs);
    await this.dataSource.query(
      `UPDATE "disponibilidad"."outbox_stock" SET "intentos" = $2, "proximoIntentoEn" = now() + make_interval(secs => $3), "enviandoHasta" = NULL, "ultimoError" = $4 WHERE "id" = $1 AND "estado" = 'PENDIENTE'`,
      [fila.id, intentos, espera / 1000, error.slice(0, 300)],
    );
  }
}
