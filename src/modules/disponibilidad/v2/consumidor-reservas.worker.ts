import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { CanalConfirmacionAmqp, conectarAmqp, ConexionAmqp, MensajeAmqp } from './amqp/cliente-amqp';
import { InventarioEventosService, leerEvento, ResultadoEvento, TIPOS_CONSUMIDOS } from './inventario-eventos.service';

// Consumidor RabbitMQ de los eventos de reservas que mueven el inventario (Paso 3). event-bus publica cada evento de
// outbox_reservas en el exchange topic cozy.reservas con routing key = tipo. Esta cola es de disponibilidad: la declara
// y la enlaza este mismo consumidor (assert* es idempotente), con su DLQ en cozy.dlx como el resto de colas del bus.
//
// prefetch(1): un mensaje a la vez, en el orden de la cola (el check-out llega antes que su habitacion.limpia.lista).
// Fallo transitorio (p. ej. la base caída): se reintenta con espera creciente; al quinto intento va a la DLQ.
// Un cuerpo que no es un CloudEvent válido va directo a la DLQ: reintentarlo no lo arreglaría.

export const EXCHANGE_RESERVAS = 'cozy.reservas';
export const EXCHANGE_DLX = 'cozy.dlx';
export const COLA_INVENTARIO = 'disponibilidad.reservas-inventario';
export const DLQ_INVENTARIO = `${COLA_INVENTARIO}.dlq`;
export const MAX_INTENTOS = 5;

const ESPERA_RECONEXION_MS = 5000;
const INTERVALO_LIMPIEZA_MS = 60_000;

export interface CanalTopologia {
  assertExchange(exchange: string, tipo: string, opciones?: { durable?: boolean }): Promise<unknown>;
  assertQueue(cola: string, opciones?: { durable?: boolean; arguments?: Record<string, unknown> }): Promise<unknown>;
  bindQueue(cola: string, exchange: string, patron: string): Promise<unknown>;
}

export async function declararColaInventario(canal: CanalTopologia): Promise<void> {
  await canal.assertExchange(EXCHANGE_DLX, 'topic', { durable: true });
  await canal.assertExchange(EXCHANGE_RESERVAS, 'topic', { durable: true });
  await canal.assertQueue(DLQ_INVENTARIO, { durable: true });
  await canal.bindQueue(DLQ_INVENTARIO, EXCHANGE_DLX, DLQ_INVENTARIO);
  await canal.assertQueue(COLA_INVENTARIO, { durable: true, arguments: { 'x-dead-letter-exchange': EXCHANGE_DLX, 'x-dead-letter-routing-key': DLQ_INVENTARIO } });
  for (const tipo of TIPOS_CONSUMIDOS) await canal.bindQueue(COLA_INVENTARIO, EXCHANGE_RESERVAS, tipo);
}

// Sin RABBITMQ_URL ni RABBITMQ_HOST el consumidor no arranca (entornos sin bus); la URL nunca se registra en logs.
export function urlRabbit(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.RABBITMQ_URL?.trim();
  if (url) return url;
  const host = env.RABBITMQ_HOST?.trim();
  if (!host) return null;
  return ['amqp', `${host}:${env.RABBITMQ_PORT?.trim() || '5672'}`].join('://');
}

export type Destino = 'ack' | 'reintentar' | 'dlq';

@Injectable()
export class ConsumidorReservasWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ConsumidorReservas');
  private conexion: ConexionAmqp | null = null;
  private canal: CanalConfirmacionAmqp | null = null;
  private destruido = false;
  private reconexion?: NodeJS.Timeout;
  private limpieza?: NodeJS.Timeout;
  private limpiando = false;
  private readonly intentos = new Map<string, number>();

  constructor(
    private readonly inventario: InventarioEventosService,
    @Optional() private readonly conectar: (url: string) => Promise<ConexionAmqp> = conectarAmqp,
  ) {}

  onModuleInit(): void {
    // La retención diaria de habitaciones sucias no depende del bus
    this.limpieza = setInterval(() => void this.extenderLimpieza(), INTERVALO_LIMPIEZA_MS);
    this.limpieza.unref();
    if (!urlRabbit()) {
      this.log.log('Consumidor de reservas inactivo: sin RABBITMQ_URL ni RABBITMQ_HOST.');
      return;
    }
    void this.iniciar();
  }

  async onModuleDestroy(): Promise<void> {
    this.destruido = true;
    if (this.reconexion) clearTimeout(this.reconexion);
    if (this.limpieza) clearInterval(this.limpieza);
    await this.cerrar();
  }

  private async iniciar(): Promise<void> {
    if (this.destruido) return;
    const url = urlRabbit();
    if (!url) return;
    try {
      this.conexion = await this.conectar(url);
      this.conexion.on('error', (e: Error) => this.log.warn(`Conexión RabbitMQ con error: ${e.message}`));
      this.conexion.on('close', () => this.programarReconexion());
      this.canal = await this.conexion.createConfirmChannel();
      await declararColaInventario(this.canal);
      await this.canal.prefetch(1);
      const canal = this.canal;
      await canal.consume(COLA_INVENTARIO, (msg) => {
        if (msg) void this.atender(canal, msg);
      });
      this.log.log(`Consumiendo ${COLA_INVENTARIO} (${TIPOS_CONSUMIDOS.join(', ')}).`);
    } catch (e) {
      this.log.warn(`RabbitMQ no disponible (${(e as Error).message}); se reintentará.`);
      await this.cerrar();
      this.programarReconexion();
    }
  }

  private programarReconexion(): void {
    if (this.destruido || this.reconexion) return;
    this.canal = null;
    this.conexion = null;
    this.reconexion = setTimeout(() => {
      this.reconexion = undefined;
      void this.iniciar();
    }, ESPERA_RECONEXION_MS);
    this.reconexion.unref();
  }

  private async cerrar(): Promise<void> {
    try {
      await this.canal?.close();
    } catch {
      /* ya cerrado */
    }
    try {
      await this.conexion?.close();
    } catch {
      /* ya cerrada */
    }
    this.canal = null;
    this.conexion = null;
  }

  // Procesa un mensaje y decide su destino. Público para las pruebas.
  async atender(canal: Pick<CanalConfirmacionAmqp, 'ack' | 'nack'>, msg: MensajeAmqp, esperar: (ms: number) => Promise<void> = dormir): Promise<Destino> {
    const evento = leerEvento(msg.content);
    if (!evento) {
      this.log.error(`Mensaje inválido en ${COLA_INVENTARIO} (routing key ${msg.fields.routingKey}): a la DLQ.`);
      canal.nack(msg, false, false);
      return 'dlq';
    }
    try {
      const resultado: ResultadoEvento = await this.inventario.procesar(evento);
      this.intentos.delete(evento.id);
      canal.ack(msg);
      if (resultado !== 'DUPLICADO' && resultado !== 'IGNORADO') this.log.log(`${evento.type} ${evento.id}: ${resultado}`);
      return 'ack';
    } catch (e) {
      const intento = (this.intentos.get(evento.id) ?? 0) + 1;
      if (intento >= MAX_INTENTOS) {
        this.intentos.delete(evento.id);
        this.log.error(`${evento.type} ${evento.id} falló ${intento} veces (${(e as Error).message}): a la DLQ ${DLQ_INVENTARIO}.`);
        canal.nack(msg, false, false);
        return 'dlq';
      }
      this.intentos.set(evento.id, intento);
      this.log.warn(`${evento.type} ${evento.id} falló (intento ${intento}/${MAX_INTENTOS}): ${(e as Error).message}. Se reintentará.`);
      await esperar(1000 * intento);
      canal.nack(msg, false, true);
      return 'reintentar';
    }
  }

  private async extenderLimpieza(): Promise<void> {
    if (this.limpiando) return;
    this.limpiando = true;
    try {
      const n = await this.inventario.extenderRetencionesDeLimpieza();
      if (n > 0) this.log.log(`Retención por limpieza extendida a hoy en ${n} habitaciones sucias.`);
    } catch (e) {
      this.log.error(`No se pudo extender las retenciones de limpieza: ${(e as Error).message}`);
    } finally {
      this.limpiando = false;
    }
  }
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
