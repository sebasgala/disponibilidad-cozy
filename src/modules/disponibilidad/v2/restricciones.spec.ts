import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluarRestricciones, instanteDeLlegada, RestriccionNoche } from './restricciones';

const estancia = ['2026-12-10', '2026-12-11', '2026-12-12']; // 3 noches, salida el 13
const SALIDA = '2026-12-13';
const LEJOS = new Date('2026-11-01T12:00:00Z');
const con = (...filas: RestriccionNoche[]) => new Map(filas.map((f) => [f.fecha, f]));

test('Sin restricciones (o noches sin fila) se puede vender', () => {
  assert.equal(evaluarRestricciones(estancia, SALIDA, new Map(), LEJOS), null);
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-11' }), LEJOS), null);
});

test('MIN_STAY se mide en la noche de llegada', () => {
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-10', estanciaMinima: 4 }), LEJOS)?.restriccion, 'MIN_STAY');
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-10', estanciaMinima: 3 }), LEJOS), null);
  // Una estancia mínima en una noche intermedia no aplica: solo cuenta la de llegada
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-11', estanciaMinima: 7 }), LEJOS), null);
});

test('MAX_STAY se mide en la noche de llegada', () => {
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-10', estanciaMaxima: 2 }), LEJOS)?.restriccion, 'MAX_STAY');
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-10', estanciaMaxima: 3 }), LEJOS), null);
});

test('STOP_SELL en cualquier noche de la estancia, pero no en el día de salida', () => {
  const v = evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-12', ventaCerrada: true }), LEJOS);
  assert.equal(v?.restriccion, 'STOP_SELL');
  assert.equal(v?.fecha, '2026-12-12');
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: SALIDA, ventaCerrada: true }), LEJOS), null);
});

test('CLOSED_TO_ARRIVAL y CLOSED_TO_DEPARTURE', () => {
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-10', cerradoALlegada: true }), LEJOS)?.restriccion, 'CLOSED_TO_ARRIVAL');
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-11', cerradoALlegada: true }), LEJOS), null);
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: SALIDA, cerradoASalida: true }), LEJOS)?.restriccion, 'CLOSED_TO_DEPARTURE');
  assert.equal(evaluarRestricciones(estancia, SALIDA, con({ fecha: '2026-12-10', cerradoASalida: true }), LEJOS), null);
});

test('CUTOFF con reloj controlado: horas hasta las 14:00 de Guayaquil del día de llegada', () => {
  const llegada = instanteDeLlegada('2026-12-10');
  assert.equal(llegada.toISOString(), '2026-12-10T19:00:00.000Z');
  const reglas = con({ fecha: '2026-12-10', anticipacionMinimaHoras: 24 });
  const horasAntes = (h: number) => new Date(llegada.getTime() - h * 3_600_000);
  assert.equal(evaluarRestricciones(estancia, SALIDA, reglas, horasAntes(23.99))?.restriccion, 'CUTOFF');
  assert.equal(evaluarRestricciones(estancia, SALIDA, reglas, horasAntes(24)), null);
  assert.equal(evaluarRestricciones(estancia, SALIDA, reglas, horasAntes(48)), null);
});
