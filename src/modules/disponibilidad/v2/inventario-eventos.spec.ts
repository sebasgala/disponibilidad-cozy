import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { RefHabitacionStock } from '../../catalogo/catalogo.puerto';
import {
  ALERTA_LIMPIEZA_SIN_CUPO,
  ALERTA_RESERVA_SIN_CUPO,
  Alerta,
  AlmacenInventario,
  EventoEntrante,
  FuenteInventario,
  leerEvento,
  LogicaInventario,
  NocheLimpieza,
  ResultadoEvento,
  RetencionCuposFila,
  RetencionLimpiezaFila,
} from './inventario-eventos.service';
import { ConsumidorReservasWorker, declararColaInventario, COLA_INVENTARIO, DLQ_INVENTARIO, MAX_INTENTOS } from './consumidor-reservas.worker';
import { MensajeAmqp } from './amqp/cliente-amqp';

// Paso 3: inventario gobernado por eventos de reservas. Base simulada en memoria con las mismas reglas que el SQL:
// cupos nunca negativos, nunca por encima de cuposTotales, retenciones por orden e idempotencia por id del sobre.

const HAB = '11111111-1111-4111-8111-111111111111';
const ORDEN = '22222222-2222-4222-8222-222222222222';
const HABITACION: RefHabitacionStock = { id: HAB, alojamientoId: 1, codigo: 'SUITE', activo: true, alojamientoCodigo: 'HTL-COZY-UIO-001', alojamientoActivo: true };

let secuencia = 0;
const idEvento = () => `00000000-0000-4000-8000-${String(++secuencia).padStart(12, '0')}`;

class BaseSimulada {
  noches = new Map<string, { cupos: number; cuposTotales: number }>(); // clave = fecha (una sola habitación)
  retenciones = new Map<string, RetencionCuposFila>();
  limpieza = new Map<string, RetencionLimpiezaFila & { habitacionFisicaId: string | null }>();
  nochesLimpieza = new Map<string, NocheLimpieza[]>();
  procesados = new Map<string, string>();
  alertas: Alerta[] = [];
  encolados: { fechas: string[]; motivo: string }[] = [];

  cupos(fecha: string): number | undefined {
    return this.noches.get(fecha)?.cupos;
  }

  // Cada transacción trabaja sobre una copia; si lanza, no se aplica nada (como un ROLLBACK)
  fuente(): FuenteInventario {
    return {
      enTransaccion: async (trabajo) => {
        const respaldo = structuredClone({ n: [...this.noches], r: [...this.retenciones], l: [...this.limpieza], nl: [...this.nochesLimpieza], p: [...this.procesados], a: this.alertas, e: this.encolados });
        try {
          return await trabajo(this.almacen());
        } catch (e) {
          this.noches = new Map(respaldo.n);
          this.retenciones = new Map(respaldo.r);
          this.limpieza = new Map(respaldo.l);
          this.nochesLimpieza = new Map(respaldo.nl);
          this.procesados = new Map(respaldo.p);
          this.alertas = respaldo.a;
          this.encolados = respaldo.e;
          throw e;
        }
      },
      habitacionDeRetencion: async (ordenId) => this.retenciones.get(ordenId)?.habitacionId ?? null,
      pendientesSinNoche: async (hoy) =>
        [...this.limpieza.entries()]
          .filter(([o, r]) => r.estado === 'PENDIENTE' && r.checkout! <= hoy && !(this.nochesLimpieza.get(o) ?? []).some((n) => n.fecha === hoy))
          .map(([ordenId, r]) => ({ ordenId, habitacionId: r.habitacionId! })),
    };
  }

  private almacen(): AlmacenInventario {
    const rango = (checkin: string, checkout: string) => [...this.noches.keys()].filter((f) => f >= checkin && f < checkout).sort();
    return {
      reclamarEvento: async (id) => (this.procesados.has(id) ? false : (this.procesados.set(id, 'EN_CURSO'), true)),
      anotarResultado: async (id, r) => void this.procesados.set(id, r),
      retencionCupos: async (o) => this.retenciones.get(o) ?? null,
      bloquearNoches: async (_h, ci, co) => rango(ci, co).map((fecha) => ({ fecha, cupos: this.noches.get(fecha)!.cupos })),
      descontarUnoPorNoche: async (ordenId, habitacionId, checkin, checkout) => {
        for (const f of rango(checkin, checkout)) {
          const n = this.noches.get(f)!;
          if (n.cupos < 1) throw new Error('cupo negativo');
          n.cupos -= 1;
        }
        this.retenciones.set(ordenId, { habitacionId, checkin, checkout, cantidad: 1, estado: 'RETENIDA' });
      },
      liberarRetencion: async (o) => {
        const r = this.retenciones.get(o)!;
        for (const f of rango(r.checkin, r.checkout)) {
          const n = this.noches.get(f)!;
          n.cupos = Math.min(n.cupos + r.cantidad, n.cuposTotales);
        }
        r.estado = 'LIBERADA';
      },
      retencionLimpieza: async (o) => this.limpieza.get(o) ?? null,
      crearRetencionLimpieza: async (o, habitacionId, checkout) => void this.limpieza.set(o, { habitacionId, checkout, estado: 'PENDIENTE', habitacionFisicaId: null }),
      crearLapidaLimpieza: async (o, hf) => void (this.limpieza.has(o) || this.limpieza.set(o, { habitacionId: null, checkout: null, estado: 'LIBERADA', habitacionFisicaId: hf })),
      liberarRetencionLimpieza: async (o, hf) => {
        const r = this.limpieza.get(o)!;
        r.estado = 'LIBERADA';
        r.habitacionFisicaId = hf ?? r.habitacionFisicaId;
      },
      nochesLimpieza: async (o) => [...(this.nochesLimpieza.get(o) ?? [])],
      descontarNocheSiHay: async (_h, fecha) => {
        const n = this.noches.get(fecha);
        if (!n || n.cupos <= 0) return 0;
        n.cupos -= 1;
        return 1;
      },
      anotarNocheLimpieza: async (o, fecha, cantidad) => {
        const lista = this.nochesLimpieza.get(o) ?? [];
        if (lista.some((n) => n.fecha === fecha)) return false;
        lista.push({ fecha, cantidad, devuelta: false });
        this.nochesLimpieza.set(o, lista);
        return true;
      },
      devolverNoche: async (_h, fecha) => {
        const n = this.noches.get(fecha);
        if (n) n.cupos = Math.min(n.cupos + 1, n.cuposTotales);
      },
      marcarNochesDevueltas: async (o) => (this.nochesLimpieza.get(o) ?? []).forEach((n) => (n.devuelta = true)),
      alertar: async (a) => void this.alertas.push(a),
      encolarStock: async (_h, fechas, motivo) => void this.encolados.push({ fechas, motivo }),
    };
  }
}

function entorno(noches: Record<string, [cupos: number, totales: number]>, hoy = '2026-11-10') {
  const base = new BaseSimulada();
  for (const [f, [cupos, cuposTotales]] of Object.entries(noches)) base.noches.set(f, { cupos, cuposTotales });
  const reloj = { hoy };
  const logica = new LogicaInventario(
    base.fuente(),
    { porCodigos: async (a, t) => (a === HABITACION.alojamientoCodigo && t === HABITACION.codigo ? HABITACION : null), porIds: async (ids) => new Map(ids.filter((i) => i === HAB).map((i) => [i, HABITACION])) },
    () => reloj.hoy,
  );
  return { base, logica, reloj };
}

const evento = (type: string, data: Record<string, unknown>, id = idEvento()): EventoEntrante => ({ id, type, data });
const reserva = (type: string, extra: Record<string, unknown> = {}) =>
  evento(type, { orderId: ORDEN, alojamientoId: 'HTL-COZY-UIO-001', tipoHabitacionCodigo: 'SUITE', checkin: '2026-11-10', checkout: '2026-11-13', ...extra });

describe('Paso 3 · regla 1: descuento estricto por noche exacta', () => {
  it('descuenta 1 solo en las noches [checkin, checkout): el día de salida no se toca', async () => {
    const { base, logica } = entorno({ '2026-11-09': [5, 5], '2026-11-10': [5, 5], '2026-11-11': [5, 5], '2026-11-12': [5, 5], '2026-11-13': [5, 5] });
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.confirmada')), 'DESCONTADA');
    assert.deepEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((f) => base.cupos(f)), [5, 4, 4, 4, 5]);
    assert.deepEqual(base.encolados.at(-1), { fechas: ['2026-11-10', '2026-11-11', '2026-11-12'], motivo: 'RESERVA' });
  });

  it('idempotente: el mismo id de sobre es DUPLICADO y otro id de la misma orden es YA_DESCONTADA, sin volver a descontar', async () => {
    const { base, logica } = entorno({ '2026-11-10': [5, 5], '2026-11-11': [5, 5], '2026-11-12': [5, 5] });
    const e = reserva('alojamiento.reserva.confirmada');
    await logica.procesar(e);
    assert.equal(await logica.procesar(e), 'DUPLICADO');
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.confirmada')), 'YA_DESCONTADA');
    assert.equal(base.cupos('2026-11-11'), 4);
  });

  it('sin doble conteo con la saga: si la orden ya retiene cupos, el evento no los vuelve a descontar', async () => {
    const { base, logica } = entorno({ '2026-11-10': [3, 5], '2026-11-11': [3, 5], '2026-11-12': [3, 5] });
    base.retenciones.set(ORDEN, { habitacionId: HAB, checkin: '2026-11-10', checkout: '2026-11-13', cantidad: 2, estado: 'RETENIDA' });
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.confirmada')), 'YA_DESCONTADA');
    assert.equal(base.cupos('2026-11-11'), 3);
  });
});

describe('Paso 3 · regla 1: rechazo con stock 0 (sin overbooking)', () => {
  it('una noche en 0: no descuenta NINGUNA, deja alerta y sincroniza a Booking el 0 de la noche agotada', async () => {
    const { base, logica } = entorno({ '2026-11-10': [2, 5], '2026-11-11': [0, 5], '2026-11-12': [2, 5] });
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.confirmada')), 'SIN_CUPO');
    assert.deepEqual(['2026-11-10', '2026-11-11', '2026-11-12'].map((f) => base.cupos(f)), [2, 0, 2]);
    assert.equal(base.retenciones.has(ORDEN), false);
    assert.equal(base.alertas.length, 1);
    assert.equal(base.alertas[0].accion, ALERTA_RESERVA_SIN_CUPO);
    assert.deepEqual(base.alertas[0].datos.nochesSinCupo, ['2026-11-11']);
    assert.deepEqual(base.encolados, [{ fechas: ['2026-11-11'], motivo: 'RESERVA' }]);
  });

  it('una noche sin fila de inventario cuenta como agotada', async () => {
    const { base, logica } = entorno({ '2026-11-10': [2, 5], '2026-11-12': [2, 5] });
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.confirmada')), 'SIN_CUPO');
    assert.deepEqual(base.alertas[0].datos.nochesSinCupo, ['2026-11-11']);
    assert.equal(base.cupos('2026-11-10'), 2);
  });

  it('si el descuento falla a mitad, se deshace todo, también el reclamo del evento (se podrá reintentar)', async () => {
    const { base, logica } = entorno({ '2026-11-10': [1, 5], '2026-11-11': [1, 5], '2026-11-12': [1, 5] });
    const original = base.fuente.bind(base);
    base.fuente = () => {
      const f = original();
      return { ...f, enTransaccion: (t) => f.enTransaccion(async (a) => t({ ...a, encolarStock: async () => { throw new Error('caída'); } })) };
    };
    const { logica: l2 } = { logica: new LogicaInventario(base.fuente(), { porCodigos: async () => HABITACION, porIds: async () => new Map([[HAB, HABITACION]]) }, () => '2026-11-10') };
    const e = reserva('alojamiento.reserva.confirmada');
    await assert.rejects(() => l2.procesar(e), /caída/);
    assert.equal(base.cupos('2026-11-11'), 1);
    assert.equal(base.procesados.has(e.id), false);
    void logica;
  });
});

describe('Paso 3 · regla 2: liberación por cancelación', () => {
  it('devuelve +1 en las noches retenidas sin pasar nunca de cuposTotales', async () => {
    const { base, logica } = entorno({ '2026-11-10': [4, 5], '2026-11-11': [5, 5], '2026-11-12': [4, 5], '2026-11-13': [4, 5] });
    base.retenciones.set(ORDEN, { habitacionId: HAB, checkin: '2026-11-10', checkout: '2026-11-13', cantidad: 1, estado: 'RETENIDA' });
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.cancelada')), 'LIBERADA');
    assert.deepEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((f) => base.cupos(f)), [5, 5, 5, 4]);
    assert.deepEqual(base.encolados.at(-1), { fechas: ['2026-11-10', '2026-11-11', '2026-11-12'], motivo: 'CANCELACION' });
  });

  it('idempotente: una segunda cancelación (otro id) es YA_LIBERADA; la saga ya liberó → no suma otra vez', async () => {
    const { base, logica } = entorno({ '2026-11-10': [4, 5], '2026-11-11': [4, 5], '2026-11-12': [4, 5] });
    base.retenciones.set(ORDEN, { habitacionId: HAB, checkin: '2026-11-10', checkout: '2026-11-13', cantidad: 1, estado: 'RETENIDA' });
    await logica.procesar(reserva('alojamiento.reserva.cancelada'));
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.cancelada')), 'YA_LIBERADA');
    assert.equal(base.cupos('2026-11-11'), 5);
  });

  it('sin retención de la orden no inventa cupos (evita disponibilidad fantasma)', async () => {
    const { base, logica } = entorno({ '2026-11-10': [2, 5], '2026-11-11': [2, 5], '2026-11-12': [2, 5] });
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.cancelada')), 'SIN_RETENCION');
    assert.equal(base.cupos('2026-11-11'), 2);
  });

  it('confirmar → cancelar → confirmar con otro id: la orden cancelada no vuelve a descontar', async () => {
    const { base, logica } = entorno({ '2026-11-10': [5, 5], '2026-11-11': [5, 5], '2026-11-12': [5, 5] });
    await logica.procesar(reserva('alojamiento.reserva.confirmada'));
    await logica.procesar(reserva('alojamiento.reserva.cancelada'));
    assert.equal(await logica.procesar(reserva('alojamiento.reserva.confirmada')), 'YA_LIBERADA');
    assert.equal(base.cupos('2026-11-11'), 5);
  });
});

describe('Paso 3 · regla 3: retención post-check-out y liberación con habitacion.limpia.lista', () => {
  const checkout = (hoy?: string) => evento('alojamiento.checkout.completado', { orderId: ORDEN, alojamientoId: 'HTL-COZY-UIO-001', tipoHabitacionCodigo: 'SUITE', checkin: '2026-11-10', checkout: '2026-11-13', inventarioFisicoLiberado: false, hoy });
  const limpia = () => evento('habitacion.limpia.lista', { reservaId: ORDEN, alojamientoId: 'HTL-COZY-UIO-001', tipoHabitacionCodigo: 'SUITE', habitacionFisicaId: 'hf-101', checkin: '2026-11-10', checkout: '2026-11-13', timestamp: '2026-11-13T11:00:00-05:00' });

  it('el check-out no libera nada; si hoy ≥ checkout retiene el cupo de hoy', async () => {
    const { base, logica } = entorno({ '2026-11-12': [3, 5], '2026-11-13': [5, 5], '2026-11-14': [5, 5] }, '2026-11-13');
    assert.equal(await logica.procesar(checkout()), 'RETENIDA_LIMPIEZA');
    assert.deepEqual(['2026-11-12', '2026-11-13', '2026-11-14'].map((f) => base.cupos(f)), [3, 4, 5]);
    assert.equal(base.limpieza.get(ORDEN)?.estado, 'PENDIENTE');
  });

  it('check-out anticipado (hoy < checkout): no retiene todavía; las noches de la estancia ya están descontadas', async () => {
    const { base, logica } = entorno({ '2026-11-12': [3, 5], '2026-11-13': [5, 5] }, '2026-11-12');
    assert.equal(await logica.procesar(checkout()), 'RETENIDA_LIMPIEZA');
    assert.deepEqual([base.cupos('2026-11-12'), base.cupos('2026-11-13')], [3, 5]);
  });

  it('habitacion.limpia.lista devuelve el cupo retenido (con tope) y es idempotente', async () => {
    const { base, logica } = entorno({ '2026-11-13': [5, 5], '2026-11-14': [5, 5] }, '2026-11-13');
    await logica.procesar(checkout());
    assert.equal(base.cupos('2026-11-13'), 4);
    assert.equal(await logica.procesar(limpia()), 'LIMPIEZA_LIBERADA');
    assert.equal(base.cupos('2026-11-13'), 5);
    assert.equal(base.limpieza.get(ORDEN)?.habitacionFisicaId, 'hf-101');
    assert.equal(await logica.procesar(limpia()), 'YA_LIMPIA');
    assert.equal(base.cupos('2026-11-13'), 5);
  });

  it('cada día que sigue sucia también se retiene; al limpiar solo se devuelve hoy y lo futuro, no lo pasado', async () => {
    const { base, logica, reloj } = entorno({ '2026-11-13': [5, 5], '2026-11-14': [5, 5], '2026-11-15': [5, 5] }, '2026-11-13');
    await logica.procesar(checkout());
    reloj.hoy = '2026-11-14';
    assert.equal(await logica.extenderRetencionesDeLimpieza(), 1);
    assert.equal(await logica.extenderRetencionesDeLimpieza(), 0, 'idempotente en el mismo día');
    assert.deepEqual([base.cupos('2026-11-13'), base.cupos('2026-11-14')], [4, 4]);
    await logica.procesar(limpia());
    assert.deepEqual([base.cupos('2026-11-13'), base.cupos('2026-11-14'), base.cupos('2026-11-15')], [4, 5, 5]);
  });

  it('habitación sucia con el día vendido: no baja de 0, deja alerta y al limpiar no suma de más', async () => {
    const { base, logica } = entorno({ '2026-11-13': [0, 5] }, '2026-11-13');
    await logica.procesar(checkout());
    assert.equal(base.cupos('2026-11-13'), 0);
    assert.equal(base.alertas.at(-1)?.accion, ALERTA_LIMPIEZA_SIN_CUPO);
    await logica.procesar(limpia());
    assert.equal(base.cupos('2026-11-13'), 0);
  });

  it('limpieza antes que el check-out (reordenamiento): deja lápida y el check-out tardío ya no retiene', async () => {
    const { base, logica } = entorno({ '2026-11-13': [5, 5] }, '2026-11-13');
    assert.equal(await logica.procesar(limpia()), 'SIN_RETENCION_LIMPIEZA');
    assert.equal(await logica.procesar(checkout()), 'YA_LIMPIA');
    assert.equal(base.cupos('2026-11-13'), 5);
  });
});

describe('Paso 3 · consumidor RabbitMQ', () => {
  const mensaje = (cuerpo: unknown): MensajeAmqp => ({
    content: Buffer.from(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    fields: { deliveryTag: 1, redelivered: false, exchange: 'cozy.reservas', routingKey: 'alojamiento.reserva.confirmada' },
    properties: {},
  });
  const canal = () => {
    const r = { acks: 0, nacks: [] as boolean[] };
    return { r, c: { ack: () => void r.acks++, nack: (_m: MensajeAmqp, _a?: boolean, requeue?: boolean) => void r.nacks.push(requeue ?? true) } };
  };
  const sobre = { id: '33333333-3333-4333-8333-333333333333', type: 'alojamiento.reserva.confirmada', data: { orderId: ORDEN } };

  it('leerEvento exige un CloudEvent con id UUID, type y data objeto', () => {
    assert.ok(leerEvento(JSON.stringify(sobre)));
    assert.equal(leerEvento('no json'), null);
    assert.equal(leerEvento(JSON.stringify({ ...sobre, id: 'x' })), null);
    assert.equal(leerEvento(JSON.stringify({ ...sobre, data: [] })), null);
  });

  it('procesado → ack; cuerpo inválido → DLQ sin reintentar', async () => {
    const w = new ConsumidorReservasWorker({ procesar: async (): Promise<ResultadoEvento> => 'DESCONTADA' } as never);
    const { r, c } = canal();
    assert.equal(await w.atender(c, mensaje(sobre)), 'ack');
    assert.equal(await w.atender(c, mensaje('{malo')), 'dlq');
    assert.deepEqual([r.acks, r.nacks], [1, [false]]);
  });

  it(`fallo transitorio: reintenta y al intento ${MAX_INTENTOS} va a la DLQ`, async () => {
    const w = new ConsumidorReservasWorker({ procesar: async () => { throw new Error('base caída'); } } as never);
    const { r, c } = canal();
    const destinos = [];
    for (let i = 0; i < MAX_INTENTOS; i++) destinos.push(await w.atender(c, mensaje(sobre), async () => {}));
    assert.deepEqual(destinos, [...Array(MAX_INTENTOS - 1).fill('reintentar'), 'dlq']);
    assert.deepEqual(r.nacks, [...Array(MAX_INTENTOS - 1).fill(true), false]);
  });

  it('declara su cola con DLQ y la enlaza a cozy.reservas por los cuatro tipos', async () => {
    const enlaces: string[] = [];
    const colas: { cola: string; args?: Record<string, unknown> }[] = [];
    await declararColaInventario({
      assertExchange: async () => ({}),
      assertQueue: async (cola, o) => void colas.push({ cola, args: o?.arguments }),
      bindQueue: async (cola, ex, patron) => void enlaces.push(`${cola}|${ex}|${patron}`),
    });
    assert.ok(colas.some((c) => c.cola === COLA_INVENTARIO && c.args?.['x-dead-letter-routing-key'] === DLQ_INVENTARIO));
    for (const t of ['alojamiento.reserva.confirmada', 'alojamiento.reserva.cancelada', 'alojamiento.checkout.completado', 'habitacion.limpia.lista']) {
      assert.ok(enlaces.includes(`${COLA_INVENTARIO}|cozy.reservas|${t}`), t);
    }
  });
});
