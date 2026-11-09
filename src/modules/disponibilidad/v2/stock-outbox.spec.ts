import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { StockOutboxService } from './stock-outbox.service';
import { habitacionesDelEvento } from './consumidor-catalogo.worker';
import { RefHabitacionStock } from '../../catalogo/catalogo.puerto';

// Fase 8.2: el aviso de stock ya no lee el catálogo. Quien llama le pasa la habitación, leída antes de abrir su
// transacción; aquí solo se leen y escriben tablas de disponibilidad con el `manager` de esa transacción.

const HABITACION: RefHabitacionStock = { id: 'h-1', alojamientoId: 7, codigo: 'SUITE', activo: true, alojamientoCodigo: 'HTL-7', alojamientoActivo: true };

function simulado(noches: { fecha: string; cupos: number }[]) {
  const sql: string[] = [];
  const emitidos: { tipo: string; sujeto: string; alojamientoId: number; datos: Record<string, unknown> }[][] = [];
  const manager = { query: async (texto: string) => (sql.push(texto.trim().split(/\s+/).slice(0, 3).join(' ')), texto.includes('disponibilidad_diaria') ? noches : []) };
  // El servicio solo recibe EventosService: no hay ningún puerto del catálogo que pueda consultar
  const servicio = new StockOutboxService({ emitir: async (_m: unknown, eventos: (typeof emitidos)[number]) => void emitidos.push(eventos) } as never);
  return { servicio, manager: manager as never, sql, emitidos };
}

test('encolar usa los códigos y el estado de la habitación que recibe', async () => {
  const s = simulado([{ fecha: '2099-01-01', cupos: 3 }]);
  await s.servicio.encolar(s.manager, HABITACION, ['2099-01-01'], 'RESERVA', 'o-1');
  assert.deepEqual(s.sql, ['SELECT "fecha"::text AS', 'INSERT INTO "disponibilidad"."outbox_stock"']);
  assert.equal(s.emitidos[0][0].sujeto, 'alojamientos/HTL-7/habitaciones/SUITE/2099-01-01');
  assert.equal(s.emitidos[0][0].alojamientoId, 7);
  assert.deepEqual(s.emitidos[0][0].datos, { alojamientoId: 'HTL-7', tipoHabitacionCodigo: 'SUITE', fecha: '2099-01-01', unidadesDisponibles: 3 });
});

test('encolar con una habitación de baja avisa 0 unidades', async () => {
  const s = simulado([{ fecha: '2099-01-01', cupos: 3 }]);
  await s.servicio.encolar(s.manager, { ...HABITACION, alojamientoActivo: false }, ['2099-01-01'], 'ESTADO');
  assert.equal(s.emitidos[0][0].datos.unidadesDisponibles, 0);
});

test('Sin habitación (no existe en el catálogo) no se avisa nada ni se consulta la base', async () => {
  const s = simulado([{ fecha: '2099-01-01', cupos: 3 }]);
  await s.servicio.encolar(s.manager, null, ['2099-01-01'], 'RESERVA');
  await s.servicio.encolarFuturas(s.manager, null);
  assert.deepEqual(s.sql, []);
  assert.deepEqual(s.emitidos, []);
});

test('Las habitaciones de cada evento del catálogo', () => {
  assert.deepEqual(habitacionesDelEvento({ tipo: 'catalogo.alojamiento.estado_cambiado', datos: { alojamientoId: 1, activo: false, habitacionIds: ['a', 'b'] } }), ['a', 'b']);
  assert.deepEqual(habitacionesDelEvento({ tipo: 'catalogo.habitacion.estado_cambiado', datos: { habitacionId: 'c', activo: true } }), ['c']);
  assert.deepEqual(habitacionesDelEvento({ tipo: 'otro', datos: {} }), []);
});
