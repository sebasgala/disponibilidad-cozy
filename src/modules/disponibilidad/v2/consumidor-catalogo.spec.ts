import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ACCION_ALERTA_BAJA, ConsumidorCatalogoWorker, esBaja, RetencionVigente } from './consumidor-catalogo.worker';
import { RegistroAuditoria } from '../../comun/auditoria.service';
import { hoyIso } from '../../comun/alojamientos-consulta.utils';

// Fase 8.2, decisión D2 (opción a): una baja del catálogo que afecta a habitaciones con reservas vigentes deja una alerta
// para el administrador; la baja en sí (aviso de stock y evento procesado) no cambia. Se recorre procesarLote() entero
// con una base simulada: los eventos pendientes, el reclamo, retenciones_cupos, la outbox de stock y la auditoría.
// Fase 9.0 (E1): los eventos son del catálogo (catalogo.eventos_catalogo) y este módulo solo los lee; lo procesado lo guarda en
// disponibilidad.eventos_catalogo_procesados (aquí, el conjunto `procesados`). Un evento procesado no cambia en el catálogo.

interface Evento { id: string; origen: string; tipo: string; datos: Record<string, any> }
interface Retencion extends RetencionVigente { estado: 'RETENIDA' | 'LIBERADA' }

const FUTURO = '2099-01-10';
const PASADO = '2000-01-01';
const retencion = (ordenId: string, habitacionId: string, cambios: Partial<Retencion> = {}): Retencion => ({
  ordenId, habitacionId, checkin: '2099-01-08', checkout: FUTURO, cantidad: 1, estado: 'RETENIDA', ...cambios,
});

function consumidor(eventos: Evento[], retenciones: Retencion[], yaProcesados: string[] = []) {
  const encolados: string[] = [];
  const alertas: RegistroAuditoria[] = [];
  const procesados = new Set(yaProcesados);
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      // El reclamo: INSERT … ON CONFLICT DO NOTHING RETURNING (nada si ya estaba)
      if (sql.includes('INSERT INTO "disponibilidad"."eventos_catalogo_procesados"')) {
        const id = params[0] as string;
        if (procesados.has(id)) return [];
        procesados.add(id);
        return [{ eventoId: id }];
      }
      // Lo mismo que el SQL: RETENIDA, de esas habitaciones y con salida posterior a hoy
      assert.match(sql, /FROM "disponibilidad"."retenciones_cupos"/);
      const [ids, hoy] = params as [string[], string];
      return retenciones.filter((r) => ids.includes(r.habitacionId) && r.estado === 'RETENIDA' && r.checkout > hoy).map(({ estado: _e, ...r }) => r);
    },
  };
  const dataSource = {
    // Los pendientes: del catálogo y sin fila en eventos_catalogo_procesados
    query: async (sql: string) => {
      assert.match(sql, /FROM "catalogo"."eventos_catalogo"/);
      assert.doesNotMatch(sql, /UPDATE|INSERT|DELETE/);
      return eventos.filter((e) => e.origen === 'catalogo' && !procesados.has(e.id));
    },
    transaction: async (fn: (m: unknown) => Promise<number>) => fn(manager),
  };
  const stock = { encolarFuturas: async (_m: unknown, h: { id: string } | null) => void encolados.push(h?.id ?? 'sin-habitacion') };
  const catalogo = { habitacionesPorIds: async (ids: string[]) => new Map(ids.map((id) => [id, { id }])) };
  const auditoria = { registrar: async (_m: unknown, r: RegistroAuditoria) => void alertas.push(r) };
  const worker = new ConsumidorCatalogoWorker(dataSource as never, stock as never, catalogo as never, auditoria as never);
  return { worker, encolados, alertas, procesados };
}

const bajaHabitacion = (id: string, habitacionId: string): Evento => ({
  id, origen: 'catalogo', tipo: 'catalogo.habitacion.estado_cambiado', datos: { habitacionId, activo: false },
});

test('Baja de una habitación con una reserva vigente: deja la alerta y la baja se procesa igual', async () => {
  const eventos = [bajaHabitacion('1', 'h-1')];
  const c = consumidor(eventos, [retencion('o-vigente', 'h-1')]);
  assert.equal(await c.worker.procesarLote(), 1);
  assert.deepEqual(c.encolados, ['h-1']); // el aviso de stock de la baja, como siempre
  assert.ok(c.procesados.has('1')); // y el evento queda procesado, en disponibilidad
  assert.equal(c.alertas.length, 1);
  assert.deepEqual(c.alertas[0], {
    modulo: 'disponibilidad', // en la auditoría de disponibilidad, que es quien la escribe
    usuarioId: null,
    accion: ACCION_ALERTA_BAJA,
    entidad: 'habitacion',
    entidadId: 'h-1',
    despues: { eventoId: '1', tipoEvento: 'catalogo.habitacion.estado_cambiado', reservasVigentes: 1,
      retenciones: [{ ordenId: 'o-vigente', habitacionId: 'h-1', checkin: '2099-01-08', checkout: FUTURO, cantidad: 1 }] },
  });
});

test('Baja de una habitación sin reservas vigentes: no hay alerta y la baja se procesa igual', async () => {
  const eventos = [bajaHabitacion('2', 'h-2')];
  // Una cancelada (LIBERADA), una ya terminada (salida pasada) y una vigente de OTRA habitación: ninguna cuenta
  const c = consumidor(eventos, [
    retencion('o-cancelada', 'h-2', { estado: 'LIBERADA' }),
    retencion('o-pasada', 'h-2', { checkin: '1999-12-30', checkout: PASADO }),
    retencion('o-otra', 'h-9'),
  ]);
  assert.equal(await c.worker.procesarLote(), 1);
  assert.deepEqual(c.encolados, ['h-2']);
  assert.ok(c.procesados.has('2'));
  assert.deepEqual(c.alertas, []);
});

test('Baja de un alojamiento: una alerta por el alojamiento con las reservas vigentes de todas sus habitaciones', async () => {
  const eventos: Evento[] = [{ id: '3', origen: 'catalogo', tipo: 'catalogo.alojamiento.estado_cambiado', datos: { alojamientoId: 7, activo: false, habitacionIds: ['h-a', 'h-b'] } }];
  const c = consumidor(eventos, [retencion('o-b', 'h-b')]);
  await c.worker.procesarLote();
  assert.deepEqual(c.encolados, ['h-a', 'h-b']);
  assert.equal(c.alertas.length, 1);
  assert.equal(c.alertas[0].entidad, 'alojamiento');
  assert.equal(c.alertas[0].entidadId, 7);
  assert.equal(c.alertas[0].despues?.reservasVigentes, 1);
});

test('Reactivar con reservas vigentes no alerta: solo las bajas', async () => {
  const eventos: Evento[] = [{ ...bajaHabitacion('4', 'h-4'), datos: { habitacionId: 'h-4', activo: true } }];
  const c = consumidor(eventos, [retencion('o-4', 'h-4')]);
  await c.worker.procesarLote();
  assert.deepEqual(c.encolados, ['h-4']);
  assert.deepEqual(c.alertas, []);
  assert.equal(esBaja(eventos[0]), false);
});

test('La fecha de corte es hoy (Guayaquil): una salida hoy ya no es vigente', async () => {
  const eventos = [bajaHabitacion('5', 'h-5')];
  const c = consumidor(eventos, [retencion('o-sale-hoy', 'h-5', { checkin: PASADO, checkout: hoyIso() })]);
  await c.worker.procesarLote();
  assert.deepEqual(c.alertas, []);
});

test('Un evento que otra instancia ya procesó se salta: ni aviso ni alerta, y no cuenta', async () => {
  const eventos = [bajaHabitacion('6', 'h-6'), bajaHabitacion('7', 'h-7')];
  const c = consumidor(eventos, [retencion('o-6', 'h-6')], []);
  // Entre la lectura de pendientes y el reclamo, otra instancia procesa el 6
  const consulta = (c.worker as never as { dataSource: { query: (s: string) => Promise<Evento[]> } }).dataSource;
  const original = consulta.query;
  consulta.query = async (sql: string) => {
    const vistos = await original(sql);
    c.procesados.add('6');
    return vistos;
  };
  assert.equal(await c.worker.procesarLote(), 1);
  assert.deepEqual(c.encolados, ['h-7']);
  assert.deepEqual(c.alertas, []);
});
