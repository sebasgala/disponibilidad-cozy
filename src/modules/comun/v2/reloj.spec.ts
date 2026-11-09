import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { estaVigente, Reloj, VIGENCIA_COTIZACION_MS, vigenteHasta } from './reloj';

// Reloj controlado: la prueba decide qué hora es y la avanza a mano
class RelojControlado extends Reloj {
  constructor(private instante: Date) {
    super();
  }
  ahora(): Date {
    return new Date(this.instante);
  }
  avanzar(ms: number): void {
    this.instante = new Date(this.instante.getTime() + ms);
  }
}

test('La cotización vale exactamente 30 minutos', () => {
  assert.equal(VIGENCIA_COTIZACION_MS, 1_800_000);
  const reloj = new RelojControlado(new Date('2026-11-01T15:00:00Z'));
  const hasta = vigenteHasta(reloj.ahora());
  assert.equal(hasta.toISOString(), '2026-11-01T15:30:00.000Z');

  assert.equal(estaVigente(hasta, reloj.ahora()), true);
  reloj.avanzar(29 * 60_000 + 59_999); // 29:59.999
  assert.equal(estaVigente(hasta, reloj.ahora()), true);
  reloj.avanzar(1); // 30:00.000
  assert.equal(estaVigente(hasta, reloj.ahora()), false);
  reloj.avanzar(60 * 60_000);
  assert.equal(estaVigente(hasta, reloj.ahora()), false);
});

test('El reloj real devuelve la hora actual', () => {
  const antes = Date.now();
  const ahora = new Reloj().ahora().getTime();
  assert.ok(ahora >= antes && ahora <= Date.now());
});
