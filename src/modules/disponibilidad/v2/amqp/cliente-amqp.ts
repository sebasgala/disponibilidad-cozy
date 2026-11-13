import { EventEmitter } from 'events';
import * as net from 'net';
import * as tls from 'tls';

// Copia del cliente AMQP 0-9-1 de event-bus/src/cliente-amqp.ts (sin dependencias: solo net/tls). Si amqplib está
// instalado lo usa; si no, el cliente nativo. Mantener sincronizado con event-bus si allí cambia el protocolo.

export interface CanalTopologiaAmqp {
  assertExchange(exchange: string, tipo: string, opciones?: { durable?: boolean }): Promise<unknown>;
  assertQueue(cola: string, opciones?: { durable?: boolean; arguments?: Record<string, unknown> }): Promise<unknown>;
  bindQueue(cola: string, exchange: string, patron: string): Promise<unknown>;
}

export interface OpcionesPublicacionAmqp {
  persistent?: boolean;
  contentType?: string;
  messageId?: string;
  correlationId?: string;
  timestamp?: number;
  headers?: Record<string, unknown>;
}

export interface MensajeAmqp {
  content: Buffer;
  fields: {
    deliveryTag: number;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
  };
  properties: {
    contentType?: string;
    headers?: Record<string, unknown>;
    deliveryMode?: number;
    correlationId?: string;
    messageId?: string;
    timestamp?: number;
  };
}

export interface CanalConfirmacionAmqp extends CanalTopologiaAmqp {
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: OpcionesPublicacionAmqp,
    callback?: (err: Error | null) => void,
  ): boolean;
  waitForConfirms(): Promise<void>;
  prefetch(count: number): Promise<void>;
  consume(
    queue: string,
    onMessage: (msg: MensajeAmqp | null) => void,
    options?: { noAck?: boolean },
  ): Promise<{ consumerTag: string }>;
  ack(message: MensajeAmqp, allUpTo?: boolean): void;
  nack(message: MensajeAmqp, allUpTo?: boolean, requeue?: boolean): void;
  close(): Promise<void>;
}

export interface ConexionAmqp {
  on(event: string, listener: (...args: any[]) => void): unknown;
  createConfirmChannel(): Promise<CanalConfirmacionAmqp>;
  close(): Promise<void>;
}

// Intenta usar amqplib si está instalado; si no, usa el cliente AMQP 0-9-1 nativo sobre net/tls.
export async function conectarAmqp(url: string): Promise<ConexionAmqp> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const amqplib = require('amqplib');
    if (amqplib && typeof amqplib.connect === 'function') {
      return (await amqplib.connect(url)) as ConexionAmqp;
    }
  } catch {
    // Continúa con el cliente AMQP 0-9-1 nativo
  }
  return conectarAmqpNativo(url);
}

// ───────────────────────── Cliente AMQP 0-9-1 nativo (con Publisher Confirms) ─────────────────────────

function escribirShortStr(texto: string): Buffer {
  const b = Buffer.from(texto, 'utf8');
  const out = Buffer.allocUnsafe(1 + b.length);
  out.writeUInt8(b.length, 0);
  b.copy(out, 1);
  return out;
}

function escribirLongStr(texto: string | Buffer): Buffer {
  const b = Buffer.isBuffer(texto) ? texto : Buffer.from(texto, 'utf8');
  const out = Buffer.allocUnsafe(4 + b.length);
  out.writeUInt32BE(b.length, 0);
  b.copy(out, 4);
  return out;
}

function escribirTabla(tabla: Record<string, unknown> = {}): Buffer {
  const partes: Buffer[] = [];
  for (const [clave, valor] of Object.entries(tabla)) {
    if (valor === undefined || valor === null) continue;
    partes.push(escribirShortStr(clave));
    if (typeof valor === 'string') {
      partes.push(Buffer.from([0x53]), escribirLongStr(valor)); // 'S'
    } else if (typeof valor === 'number' && Number.isInteger(valor)) {
      const n = Buffer.allocUnsafe(5);
      n.writeUInt8(0x49, 0); // 'I'
      n.writeInt32BE(valor, 1);
      partes.push(n);
    } else if (typeof valor === 'boolean') {
      partes.push(Buffer.from([0x74, valor ? 1 : 0])); // 't'
    }
  }
  const cuerpo = Buffer.concat(partes);
  const largo = Buffer.allocUnsafe(4);
  largo.writeUInt32BE(cuerpo.length, 0);
  return Buffer.concat([largo, cuerpo]);
}

function leerTabla(buf: Buffer, offset: number): { tabla: Record<string, unknown>; fin: number } {
  const largo = buf.readUInt32BE(offset);
  const fin = offset + 4 + largo;
  let pos = offset + 4;
  const tabla: Record<string, unknown> = {};
  while (pos < fin) {
    const kLen = buf.readUInt8(pos);
    pos += 1;
    const clave = buf.subarray(pos, pos + kLen).toString('utf8');
    pos += kLen;
    const tipo = String.fromCharCode(buf.readUInt8(pos));
    pos += 1;
    if (tipo === 'S' || tipo === 'x') {
      const vLen = buf.readUInt32BE(pos);
      pos += 4;
      tabla[clave] = buf.subarray(pos, pos + vLen).toString('utf8');
      pos += vLen;
    } else if (tipo === 'I' || tipo === 'i') {
      tabla[clave] = buf.readInt32BE(pos);
      pos += 4;
    } else if (tipo === 'l' || tipo === 'L') {
      tabla[clave] = Number(buf.readBigInt64BE(pos));
      pos += 8;
    } else if (tipo === 't') {
      tabla[clave] = buf.readUInt8(pos) !== 0;
      pos += 1;
    } else if (tipo === 'F') {
      const sub = leerTabla(buf, pos);
      tabla[clave] = sub.tabla;
      pos = sub.fin;
    } else {
      break;
    }
  }
  return { tabla, fin };
}

function armarTramaMetodo(canal: number, clase: number, metodo: number, args: Buffer): Buffer {
  const payload = Buffer.allocUnsafe(4 + args.length);
  payload.writeUInt16BE(clase, 0);
  payload.writeUInt16BE(metodo, 2);
  args.copy(payload, 4);
  const trama = Buffer.allocUnsafe(7 + payload.length + 1);
  trama.writeUInt8(1, 0); // METHOD
  trama.writeUInt16BE(canal, 1);
  trama.writeUInt32BE(payload.length, 3);
  payload.copy(trama, 7);
  trama.writeUInt8(0xce, 7 + payload.length);
  return trama;
}

class ConexionAmqpNativa extends EventEmitter implements ConexionAmqp {
  private buffer = Buffer.alloc(0);
  private esperandoMetodo: {
    canal: number;
    clase: number;
    metodo: number;
    resolver: (args: Buffer) => void;
    rechazar: (err: Error) => void;
  }[] = [];
  private canales = new Map<number, CanalConfirmacionNativo>();
  private cerrada = false;

  constructor(private readonly socket: net.Socket) {
    super();
    socket.on('data', (chunk: Buffer) => this.alRecibirDatos(chunk));
    socket.on('error', (err) => {
      this.rechazarPendientes(err);
      this.emit('error', err);
    });
    socket.on('close', () => {
      this.cerrada = true;
      this.rechazarPendientes(new Error('Conexión AMQP cerrada'));
      this.emit('close');
    });
  }

  enviar(trama: Buffer): void {
    if (this.cerrada) throw new Error('Conexión AMQP cerrada');
    this.socket.write(trama);
  }

  esperar(canal: number, clase: number, metodo: number): Promise<Buffer> {
    return new Promise((resolver, rechazar) => {
      this.esperandoMetodo.push({ canal, clase, metodo, resolver, rechazar });
    });
  }

  private rechazarPendientes(err: Error): void {
    for (const p of this.esperandoMetodo.splice(0)) p.rechazar(err);
    for (const c of this.canales.values()) c.alCerrarConexion(err);
  }

  private alRecibirDatos(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const tipo = this.buffer.readUInt8(0);
      const canal = this.buffer.readUInt16BE(1);
      const tamano = this.buffer.readUInt32BE(3);
      if (this.buffer.length < 7 + tamano + 1) break;
      const payload = this.buffer.subarray(7, 7 + tamano);
      this.buffer = this.buffer.subarray(7 + tamano + 1);

      if (tipo === 8) {
        // HEARTBEAT: responder con heartbeat idéntico
        const hb = Buffer.from([8, 0, 0, 0, 0, 0, 0, 0xce]);
        this.socket.write(hb);
        continue;
      }
      if (tipo === 1) {
        const clase = payload.readUInt16BE(0);
        const metodo = payload.readUInt16BE(2);
        const args = payload.subarray(4);
        if (clase === 10 && metodo === 50) {
          // Connection.Close -> responder Close-Ok (10, 51)
          this.enviar(armarTramaMetodo(0, 10, 51, Buffer.alloc(0)));
          this.socket.end();
          continue;
        }
        const idx = this.esperandoMetodo.findIndex((e) => e.canal === canal && e.clase === clase && e.metodo === metodo);
        if (idx >= 0) {
          const [encontrado] = this.esperandoMetodo.splice(idx, 1);
          encontrado.resolver(args);
          continue;
        }
        this.canales.get(canal)?.alMetodo(clase, metodo, args);
      } else if (tipo === 2) {
        this.canales.get(canal)?.alCabecera(payload);
      } else if (tipo === 3) {
        this.canales.get(canal)?.alCuerpo(payload);
      }
    }
  }

  async createConfirmChannel(): Promise<CanalConfirmacionAmqp> {
    const idCanal = this.canales.size + 1;
    const canal = new CanalConfirmacionNativo(this, idCanal);
    this.canales.set(idCanal, canal);
    await canal.abrir();
    return canal;
  }

  async close(): Promise<void> {
    if (this.cerrada) return;
    try {
      const ok = this.esperar(0, 10, 51);
      const args = Buffer.alloc(6);
      args.writeUInt16BE(200, 0);
      this.enviar(armarTramaMetodo(0, 10, 50, args));
      await Promise.race([ok, new Promise((r) => setTimeout(r, 500))]);
    } catch {
      // Ignorar al cerrar
    } finally {
      this.cerrada = true;
      this.socket.destroy();
    }
  }
}

class CanalConfirmacionNativo implements CanalConfirmacionAmqp {
  private seqPublicacion = 0;
  private confirmacionesPendientes = new Map<number, (err: Error | null) => void>();
  private consumidores = new Map<string, (msg: MensajeAmqp | null) => void>();
  private entregaEnCurso: {
    consumerTag: string;
    deliveryTag: number;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
    esperado: number;
    recibido: Buffer[];
    properties: MensajeAmqp['properties'];
  } | null = null;

  constructor(
    private readonly conexion: ConexionAmqpNativa,
    private readonly canal: number,
  ) {}

  async abrir(): Promise<void> {
    // Channel.Open (20, 10) -> Channel.Open-Ok (20, 11)
    const openOk = this.conexion.esperar(this.canal, 20, 11);
    this.conexion.enviar(armarTramaMetodo(this.canal, 20, 10, Buffer.from([0])));
    await openOk;

    // Confirm.Select (85, 10) -> Confirm.Select-Ok (85, 11)
    const confirmOk = this.conexion.esperar(this.canal, 85, 11);
    this.conexion.enviar(armarTramaMetodo(this.canal, 85, 10, Buffer.from([0])));
    await confirmOk;
  }

  alCerrarConexion(err: Error): void {
    for (const cb of this.confirmacionesPendientes.values()) cb(err);
    this.confirmacionesPendientes.clear();
  }

  alMetodo(clase: number, metodo: number, args: Buffer): void {
    // Basic.Ack (60, 80) o Basic.Nack (60, 120)
    if (clase === 60 && (metodo === 80 || metodo === 120)) {
      const deliveryTag = Number(args.readBigUInt64BE(0));
      const multiple = (args.readUInt8(8) & 1) !== 0;
      const esNack = metodo === 120;
      const err = esNack ? new Error(`RabbitMQ rechazó (NACK) el mensaje con secuencia ${deliveryTag}`) : null;
      if (multiple) {
        for (const [tag, cb] of [...this.confirmacionesPendientes.entries()]) {
          if (tag <= deliveryTag) {
            this.confirmacionesPendientes.delete(tag);
            cb(err);
          }
        }
      } else {
        const cb = this.confirmacionesPendientes.get(deliveryTag);
        if (cb) {
          this.confirmacionesPendientes.delete(deliveryTag);
          cb(err);
        }
      }
      return;
    }

    // Basic.Deliver (60, 60)
    if (clase === 60 && metodo === 60) {
      let pos = 0;
      const cLen = args.readUInt8(pos);
      pos += 1;
      const consumerTag = args.subarray(pos, pos + cLen).toString('utf8');
      pos += cLen;
      const deliveryTag = Number(args.readBigUInt64BE(pos));
      pos += 8;
      const redelivered = args.readUInt8(pos) !== 0;
      pos += 1;
      const exLen = args.readUInt8(pos);
      pos += 1;
      const exchange = args.subarray(pos, pos + exLen).toString('utf8');
      pos += exLen;
      const rkLen = args.readUInt8(pos);
      pos += 1;
      const routingKey = args.subarray(pos, pos + rkLen).toString('utf8');
      this.entregaEnCurso = {
        consumerTag,
        deliveryTag,
        redelivered,
        exchange,
        routingKey,
        esperado: 0,
        recibido: [],
        properties: {},
      };
    }
  }

  alCabecera(payload: Buffer): void {
    if (!this.entregaEnCurso) return;
    const tamanoCuerpo = Number(payload.readBigUInt64BE(4));
    const flags = payload.readUInt16BE(12);
    let pos = 14;
    const props: MensajeAmqp['properties'] = {};
    if (flags & 0x8000) {
      const l = payload.readUInt8(pos++);
      props.contentType = payload.subarray(pos, pos + l).toString('utf8');
      pos += l;
    }
    if (flags & 0x2000) {
      const t = leerTabla(payload, pos);
      props.headers = t.tabla;
      pos = t.fin;
    }
    if (flags & 0x1000) {
      props.deliveryMode = payload.readUInt8(pos++);
    }
    if (flags & 0x0400) {
      const l = payload.readUInt8(pos++);
      props.correlationId = payload.subarray(pos, pos + l).toString('utf8');
      pos += l;
    }
    // Bits de las propiedades de Basic (AMQP 0-9-1): content-type 0x8000, content-encoding 0x4000, headers 0x2000,
    // delivery-mode 0x1000, priority 0x0800, correlation-id 0x0400, reply-to 0x0200, expiration 0x0100,
    // message-id 0x0080, timestamp 0x0040, type 0x0020, user-id 0x0010, app-id 0x0008.
    if (flags & 0x0080) {
      const l = payload.readUInt8(pos++);
      props.messageId = payload.subarray(pos, pos + l).toString('utf8');
      pos += l;
    }
    if (flags & 0x0040) {
      props.timestamp = Number(payload.readBigUInt64BE(pos));
      pos += 8;
    }
    this.entregaEnCurso.esperado = tamanoCuerpo;
    this.entregaEnCurso.properties = props;
    if (tamanoCuerpo === 0) this.despacharEntrega();
  }

  alCuerpo(payload: Buffer): void {
    if (!this.entregaEnCurso) return;
    this.entregaEnCurso.recibido.push(payload);
    const total = this.entregaEnCurso.recibido.reduce((acc, b) => acc + b.length, 0);
    if (total >= this.entregaEnCurso.esperado) {
      this.despacharEntrega();
    }
  }

  private despacharEntrega(): void {
    const entrega = this.entregaEnCurso;
    this.entregaEnCurso = null;
    if (!entrega) return;
    const cb = this.consumidores.get(entrega.consumerTag);
    if (!cb) return;
    cb({
      content: Buffer.concat(entrega.recibido),
      fields: {
        deliveryTag: entrega.deliveryTag,
        redelivered: entrega.redelivered,
        exchange: entrega.exchange,
        routingKey: entrega.routingKey,
      },
      properties: entrega.properties,
    });
  }

  async assertExchange(exchange: string, tipo: string, opciones: { durable?: boolean } = {}): Promise<void> {
    // Exchange.Declare (40, 10) -> Exchange.Declare-Ok (40, 11)
    const ok = this.conexion.esperar(this.canal, 40, 11);
    const flags = opciones.durable !== false ? 0x02 : 0x00;
    const args = Buffer.concat([
      Buffer.from([0, 0]),
      escribirShortStr(exchange),
      escribirShortStr(tipo),
      Buffer.from([flags]),
      escribirTabla({}),
    ]);
    this.conexion.enviar(armarTramaMetodo(this.canal, 40, 10, args));
    await ok;
  }

  async assertQueue(
    cola: string,
    opciones: { durable?: boolean; arguments?: Record<string, unknown> } = {},
  ): Promise<void> {
    // Queue.Declare (50, 10) -> Queue.Declare-Ok (50, 11)
    const ok = this.conexion.esperar(this.canal, 50, 11);
    const flags = opciones.durable !== false ? 0x02 : 0x00;
    const args = Buffer.concat([
      Buffer.from([0, 0]),
      escribirShortStr(cola),
      Buffer.from([flags]),
      escribirTabla(opciones.arguments ?? {}),
    ]);
    this.conexion.enviar(armarTramaMetodo(this.canal, 50, 10, args));
    await ok;
  }

  async bindQueue(cola: string, exchange: string, patron: string): Promise<void> {
    // Queue.Bind (50, 20) -> Queue.Bind-Ok (50, 21)
    const ok = this.conexion.esperar(this.canal, 50, 21);
    const args = Buffer.concat([
      Buffer.from([0, 0]),
      escribirShortStr(cola),
      escribirShortStr(exchange),
      escribirShortStr(patron),
      Buffer.from([0]),
      escribirTabla({}),
    ]);
    this.conexion.enviar(armarTramaMetodo(this.canal, 50, 20, args));
    await ok;
  }

  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: OpcionesPublicacionAmqp = {},
    callback?: (err: Error | null) => void,
  ): boolean {
    const tag = ++this.seqPublicacion;
    if (callback) {
      this.confirmacionesPendientes.set(tag, callback);
    } else {
      this.confirmacionesPendientes.set(tag, () => {});
    }

    // 1. Basic.Publish (60, 40)
    const argsMetodo = Buffer.concat([
      Buffer.from([0, 0]),
      escribirShortStr(exchange),
      escribirShortStr(routingKey),
      Buffer.from([0]),
    ]);
    this.conexion.enviar(armarTramaMetodo(this.canal, 60, 40, argsMetodo));

    // 2. Content Header (tipo 2)
    let flags = 0;
    const propsPartes: Buffer[] = [];
    if (options.contentType) {
      flags |= 0x8000;
      propsPartes.push(escribirShortStr(options.contentType));
    }
    if (options.headers) {
      flags |= 0x2000;
      propsPartes.push(escribirTabla(options.headers));
    }
    if (options.persistent !== undefined) {
      flags |= 0x1000;
      propsPartes.push(Buffer.from([options.persistent ? 2 : 1]));
    }
    if (options.correlationId) {
      flags |= 0x0400;
      propsPartes.push(escribirShortStr(options.correlationId));
    }
    if (options.messageId) {
      flags |= 0x0080; // message-id (0x0100 es expiration)
      propsPartes.push(escribirShortStr(options.messageId));
    }
    if (options.timestamp !== undefined) {
      flags |= 0x0040; // timestamp
      const ts = Buffer.allocUnsafe(8);
      ts.writeBigUInt64BE(BigInt(options.timestamp), 0);
      propsPartes.push(ts);
    }
    const propsBuf = Buffer.concat(propsPartes);
    const headerPayload = Buffer.allocUnsafe(14 + propsBuf.length);
    headerPayload.writeUInt16BE(60, 0);
    headerPayload.writeUInt16BE(0, 2);
    headerPayload.writeBigUInt64BE(BigInt(content.length), 4);
    headerPayload.writeUInt16BE(flags, 12);
    propsBuf.copy(headerPayload, 14);

    const tramaHeader = Buffer.allocUnsafe(7 + headerPayload.length + 1);
    tramaHeader.writeUInt8(2, 0);
    tramaHeader.writeUInt16BE(this.canal, 1);
    tramaHeader.writeUInt32BE(headerPayload.length, 3);
    headerPayload.copy(tramaHeader, 7);
    tramaHeader.writeUInt8(0xce, 7 + headerPayload.length);
    this.conexion.enviar(tramaHeader);

    // 3. Content Body (tipo 3)
    const tramaBody = Buffer.allocUnsafe(7 + content.length + 1);
    tramaBody.writeUInt8(3, 0);
    tramaBody.writeUInt16BE(this.canal, 1);
    tramaBody.writeUInt32BE(content.length, 3);
    content.copy(tramaBody, 7);
    tramaBody.writeUInt8(0xce, 7 + content.length);
    this.conexion.enviar(tramaBody);
    return true;
  }

  waitForConfirms(): Promise<void> {
    if (this.confirmacionesPendientes.size === 0) return Promise.resolve();
    const etiquetas = [...this.confirmacionesPendientes.keys()];
    return new Promise((resolver, rechazar) => {
      let restantes = etiquetas.length;
      let fallado = false;
      for (const tag of etiquetas) {
        const anterior = this.confirmacionesPendientes.get(tag);
        this.confirmacionesPendientes.set(tag, (err) => {
          anterior?.(err);
          if (fallado) return;
          if (err) {
            fallado = true;
            rechazar(err);
            return;
          }
          restantes -= 1;
          if (restantes === 0) resolver();
        });
      }
    });
  }

  async prefetch(count: number): Promise<void> {
    // Basic.Qos (60, 10) -> Basic.Qos-Ok (60, 11)
    const ok = this.conexion.esperar(this.canal, 60, 11);
    const args = Buffer.allocUnsafe(7);
    args.writeUInt32BE(0, 0);
    args.writeUInt16BE(count, 4);
    args.writeUInt8(0, 6);
    this.conexion.enviar(armarTramaMetodo(this.canal, 60, 10, args));
    await ok;
  }

  async consume(
    queue: string,
    onMessage: (msg: MensajeAmqp | null) => void,
    options: { noAck?: boolean } = {},
  ): Promise<{ consumerTag: string }> {
    // Basic.Consume (60, 20) -> Basic.Consume-Ok (60, 21)
    const tag = `ctag-${this.canal}-${this.consumidores.size + 1}`;
    this.consumidores.set(tag, onMessage);
    const ok = this.conexion.esperar(this.canal, 60, 21);
    const flags = options.noAck ? 0x02 : 0x00;
    const args = Buffer.concat([
      Buffer.from([0, 0]),
      escribirShortStr(queue),
      escribirShortStr(tag),
      Buffer.from([flags]),
      escribirTabla({}),
    ]);
    this.conexion.enviar(armarTramaMetodo(this.canal, 60, 20, args));
    await ok;
    return { consumerTag: tag };
  }

  ack(message: MensajeAmqp, allUpTo = false): void {
    // Basic.Ack (60, 80)
    const args = Buffer.allocUnsafe(9);
    args.writeBigUInt64BE(BigInt(message.fields.deliveryTag), 0);
    args.writeUInt8(allUpTo ? 1 : 0, 8);
    this.conexion.enviar(armarTramaMetodo(this.canal, 60, 80, args));
  }

  nack(message: MensajeAmqp, allUpTo = false, requeue = true): void {
    // Basic.Nack (60, 120)
    const args = Buffer.allocUnsafe(9);
    args.writeBigUInt64BE(BigInt(message.fields.deliveryTag), 0);
    args.writeUInt8((allUpTo ? 1 : 0) | (requeue ? 2 : 0), 8);
    this.conexion.enviar(armarTramaMetodo(this.canal, 60, 120, args));
  }

  async close(): Promise<void> {
    try {
      const ok = this.conexion.esperar(this.canal, 20, 41);
      const args = Buffer.from([0, 200, 0, 0, 0, 0, 0]);
      this.conexion.enviar(armarTramaMetodo(this.canal, 20, 40, args));
      await Promise.race([ok, new Promise((r) => setTimeout(r, 300))]);
    } catch {
      // Ignorar errores al cerrar el canal
    }
  }
}

async function conectarAmqpNativo(urlTexto: string): Promise<ConexionAmqp> {
  const u = new URL(urlTexto);
  const esTls = u.protocol === 'amqps:';
  const host = u.hostname || 'localhost';
  const port = Number(u.port) || (esTls ? 5671 : 5672);
  const usuario = decodeURIComponent(u.username || 'guest');
  const clave = decodeURIComponent(u.password || 'guest');
  const vhost = u.pathname && u.pathname !== '/' ? decodeURIComponent(u.pathname.slice(1)) : '/';

  const socket = await new Promise<net.Socket>((resolver, rechazar) => {
    const s = esTls ? tls.connect({ host, port, rejectUnauthorized: false }) : net.createConnection({ host, port });
    const onError = (err: Error) => rechazar(err);
    s.once('error', onError);
    s.once(esTls ? 'secureConnect' : 'connect', () => {
      s.removeListener('error', onError);
      resolver(s);
    });
  });

  const conexion = new ConexionAmqpNativa(socket);
  // 1. Cabecera de protocolo AMQP 0-9-1
  const startP = conexion.esperar(0, 10, 10);
  socket.write(Buffer.from('AMQP\x00\x00\x09\x01', 'binary'));
  await startP;

  // 2. Connection.Start-Ok (10, 11) con mecanismo PLAIN
  const tuneP = conexion.esperar(0, 10, 30);
  const credenciales = Buffer.from(`\u0000${usuario}\u0000${clave}`, 'utf8');
  const startOkArgs = Buffer.concat([
    escribirTabla({ product: 'cozy-event-bus', version: '1.0.0' }),
    escribirShortStr('PLAIN'),
    escribirLongStr(credenciales),
    escribirShortStr('en_US'),
  ]);
  conexion.enviar(armarTramaMetodo(0, 10, 11, startOkArgs));
  const tuneArgs = await tuneP;

  // 3. Connection.Tune-Ok (10, 31) y Connection.Open (10, 40) -> Open-Ok (10, 41)
  const channelMax = tuneArgs.readUInt16BE(0);
  const frameMax = tuneArgs.readUInt32BE(2);
  const heartbeat = tuneArgs.readUInt16BE(6);
  const tuneOkArgs = Buffer.allocUnsafe(8);
  tuneOkArgs.writeUInt16BE(channelMax, 0);
  tuneOkArgs.writeUInt32BE(frameMax, 2);
  tuneOkArgs.writeUInt16BE(heartbeat, 6);
  conexion.enviar(armarTramaMetodo(0, 10, 31, tuneOkArgs));

  const openOkP = conexion.esperar(0, 10, 41);
  const openArgs = Buffer.concat([escribirShortStr(vhost), Buffer.from([0, 0])]);
  conexion.enviar(armarTramaMetodo(0, 10, 40, openArgs));
  await openOkP;

  return conexion;
}
