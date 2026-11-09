import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { clasificarAck, construirMensaje, esperaReintento, EstadoNoche, hashInventario, RelojMonotono, slotId, unidadesDisponibles } from './stock-envio';

const noche = (cambios: Partial<EstadoNoche> = {}): EstadoNoche => ({
  fecha: '2026-11-05',
  cupos: 3,
  habitacionActiva: true,
  alojamientoActivo: true,
  habitacionCodigo: 'SUITE_DELUXE',
  alojamientoCodigo: 'HTL-COZY-UIO-001',
  checkInDesde: '14:00',
  ...cambios,
});

test('Mensaje de stock: item_id, noche, hora y unidades absolutas', () => {
  const m = construirMensaje(noche(), 'alojamientos', 1_793_000_000_000);
  assert.deepEqual(m, {
    service_id: 'alojamientos',
    item_id: 'HTL-COZY-UIO-001:SUITE_DELUXE',
    date: '2026-11-05',
    time_slot: '14:00',
    available_units: 3,
    timestamp: 1_793_000_000_000,
    slot_id: 'slot-20261105-1400',
  });
  assert.equal(slotId('2026-12-31', '15:30'), 'slot-20261231-1530');
});

test('Una habitación o un alojamiento dados de baja envían 0 unidades', () => {
  assert.equal(unidadesDisponibles(noche()), 3);
  assert.equal(unidadesDisponibles(noche({ habitacionActiva: false })), 0);
  assert.equal(unidadesDisponibles(noche({ alojamientoActivo: false })), 0);
  assert.equal(unidadesDisponibles(noche({ cupos: 0 })), 0);
  assert.equal(unidadesDisponibles(noche({ cupos: -1 })), 0); // nunca un número negativo hacia Booking
});

test('Reintentos: 1 s, 2 s, 4 s… con tope', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => esperaReintento(i, 1000, 300_000)), [1000, 2000, 4000, 8000, 16_000]);
  assert.equal(esperaReintento(9, 1000, 300_000), 256_000);
  assert.equal(esperaReintento(10, 1000, 300_000), 300_000);
  assert.equal(esperaReintento(60, 1000, 300_000), 300_000);
  assert.equal(esperaReintento(0, 1000, 300_000), 1000);
});

test('Timestamps estrictamente crecientes, aunque el reloj no avance o retroceda', () => {
  const reloj = new RelojMonotono();
  assert.equal(reloj.siguiente(1000), 1000);
  assert.equal(reloj.siguiente(1000), 1001);
  assert.equal(reloj.siguiente(1000), 1002);
  assert.equal(reloj.siguiente(900), 1003); // el reloj del sistema retrocedió
  assert.equal(reloj.siguiente(5000), 5000);
});

test('Respuesta de Booking: qué se reintenta y qué no', () => {
  assert.equal(clasificarAck({ success: true }), 'ENVIADO');
  assert.equal(clasificarAck({ success: false, error_code: 'STALE_TIMESTAMP_IGNORED' }), 'ENVIADO');
  assert.equal(clasificarAck({ success: false, error_code: 'ITEM_NOT_FOUND' }), 'RECHAZADO');
  assert.equal(clasificarAck({ success: false, error_code: 'INVALID_SLOT' }), 'RECHAZADO');
  assert.equal(clasificarAck({ success: false, error_code: 'INTERNAL' }), 'REINTENTAR');
  assert.equal(clasificarAck({ success: false }), 'REINTENTAR');
});

test('Huella del inventario: estable, ordenada y sensible a cualquier cambio', () => {
  const a = { fecha: '2026-11-05', tipoHabitacionCodigo: 'DOBLE', disponibles: 2 };
  const b = { fecha: '2026-11-05', tipoHabitacionCodigo: 'SUITE', disponibles: 1 };
  const c = { fecha: '2026-11-06', tipoHabitacionCodigo: 'DOBLE', disponibles: 2 };
  const h = hashInventario([a, b, c]);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashInventario([c, b, a]), h); // el orden de entrada no importa
  assert.notEqual(hashInventario([a, b, { ...c, disponibles: 1 }]), h);
  assert.notEqual(hashInventario([a, b]), h);
  // El algoritmo documentado: SHA-256 de "fecha:código:disponibles" unidas con \n
  assert.equal(hashInventario([a]), '1f7a8ecb33efd5998a68f69053001380e273eedb6183368f1441079759826c37');
  assert.equal(hashInventario([b, a]), 'bfe3c2ad60ffdfc35b1eb67eadbf3e95986c2cde4e49853664f2cbc2f0663449');
});
