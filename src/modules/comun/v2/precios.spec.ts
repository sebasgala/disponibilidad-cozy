import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { aplicarAjuste, calcularPrecio, divisionHalfUp, ivaDe, PlanPrecio, repartir, TASA_MUNICIPAL_CENTAVOS } from './precios';
import { centavosAMoney } from './dinero';

const SIN_AJUSTE: PlanPrecio = { ajusteCentesimas: 0, ocupacionBase: 2, suplementoAdultoExtraCentavos: 0, edadMaximaGratis: 17, suplementoNinoCentavos: 0 };
const noches = (...precios: number[]) => precios.map((precioCentavos, i) => ({ fecha: `2026-11-${String(i + 1).padStart(2, '0')}`, precioCentavos }));

test('divisionHalfUp: el .5 sube, lo demás redondea al más cercano', () => {
  assert.equal(divisionHalfUp(5, 2), 3); // 2.5
  assert.equal(divisionHalfUp(7, 2), 4); // 3.5
  assert.equal(divisionHalfUp(3, 2), 2); // 1.5
  assert.equal(divisionHalfUp(1, 3), 0); // 0.33
  assert.equal(divisionHalfUp(2, 3), 1); // 0.67
  assert.equal(divisionHalfUp(10, 5), 2);
  assert.equal(divisionHalfUp(0, 7), 0);
  assert.throws(() => divisionHalfUp(-1, 2));
});

test('IVA 15 %: half-up a centavos', () => {
  assert.equal(ivaDe(48000), 7200); // 480.00 => 72.00
  assert.equal(ivaDe(1003), 150); // 1.5045 => 1.50
  assert.equal(ivaDe(1010), 152); // 1.515 => 1.52 (half-up, no al par)
  assert.equal(ivaDe(10), 2); // 0.015 => 0.02
  assert.equal(ivaDe(3), 0); // 0.0045 => 0.00
  assert.equal(ivaDe(4), 1); // 0.006 => 0.01
});

test('Ajuste del plan: −10 % sobre 85.55 da 77.00 (76.995 sube)', () => {
  assert.equal(aplicarAjuste(8555, -1000), 7700);
  assert.equal(aplicarAjuste(8555, 0), 8555);
  assert.equal(aplicarAjuste(10000, 1550), 11550); // +15.50 %
  assert.equal(aplicarAjuste(1, -5000), 1); // 0.005 => 0.01
  assert.throws(() => aplicarAjuste(100, -10000));
});

test('Reparto de adultos entre habitaciones', () => {
  assert.deepEqual(repartir(5, 2), [3, 2]);
  assert.deepEqual(repartir(4, 2), [2, 2]);
  assert.deepEqual(repartir(1, 3), [1, 0, 0]);
});

test('Ejemplo del contrato: 4 noches a 120.00 => 480.00 + 72.00 + 8.00 = 560.00', () => {
  const d = calcularPrecio({ noches: noches(12000, 12000, 12000, 12000), plan: SIN_AJUSTE, habitaciones: 1, adultos: 2, edadesNinos: [] });
  assert.equal(d.subtotal, 48000);
  assert.equal(d.ivaPorcentaje, 15);
  assert.equal(d.ivaValor, 7200);
  assert.equal(d.tasaMunicipal, 800);
  assert.equal(d.descuentoCombo, 0);
  assert.equal(centavosAMoney(d.total), '560.00');
  assert.equal(d.precioNocheCentavos, 12000);
});

test('Cada noche se redondea una vez y la suma cuadra exacta', () => {
  // 85.55 con −10 % = 76.995 => 77.00 por noche y habitación. Redondear el total de una vez daría 307.98, no 308.00.
  const d = calcularPrecio({ noches: noches(8555, 8555), plan: { ...SIN_AJUSTE, ajusteCentesimas: -1000 }, habitaciones: 2, adultos: 4, edadesNinos: [] });
  assert.deepEqual(d.nochesDetalle.map((n) => n.centavos), [15400, 15400]);
  assert.equal(d.subtotal, 30800);
  assert.equal(d.ivaValor, 4620);
  assert.equal(d.tasaMunicipal, TASA_MUNICIPAL_CENTAVOS * 2 * 2);
  assert.equal(d.total, 30800 + 4620 + 800);
});

test('Suplementos: adultos sobre la ocupación base y niños mayores de la edad gratis, por noche', () => {
  const plan: PlanPrecio = { ajusteCentesimas: 0, ocupacionBase: 2, suplementoAdultoExtraCentavos: 1500, edadMaximaGratis: 5, suplementoNinoCentavos: 1000 };
  // 5 adultos en 2 habitaciones = [3, 2]: 1 adulto extra. Niños de 3 y 12: paga solo el de 12.
  const d = calcularPrecio({ noches: noches(10000, 10000, 10000), plan, habitaciones: 2, adultos: 5, edadesNinos: [3, 12] });
  assert.deepEqual(d.nochesDetalle.map((n) => n.centavos), [22500, 22500, 22500]);
  assert.equal(d.subtotal, 67500);
});

test('Descuento de combo: se resta al final y no puede dejar el total negativo', () => {
  const d = calcularPrecio({ noches: noches(12000, 12000, 12000, 12000), plan: SIN_AJUSTE, habitaciones: 1, adultos: 2, edadesNinos: [], descuentoComboCentavos: 4800 });
  assert.equal(d.total, 56000 - 4800);
  assert.throws(() => calcularPrecio({ noches: noches(100), plan: SIN_AJUSTE, habitaciones: 1, adultos: 1, edadesNinos: [], descuentoComboCentavos: 999999 }));
});

test('Precio por noche informativo: promedio half-up por noche y habitación', () => {
  const d = calcularPrecio({ noches: noches(10000, 10001), plan: SIN_AJUSTE, habitaciones: 1, adultos: 1, edadesNinos: [] });
  assert.equal(d.precioNocheCentavos, 10001); // 100.005 => 100.01
});

test('Propiedad: con 2000 combinaciones el total cuadra exacto y el IVA es half-up', () => {
  let semilla = 20261027;
  const azar = (max: number) => {
    semilla = (semilla * 1103515245 + 12345) % 2147483648;
    return semilla % max;
  };
  for (let i = 0; i < 2000; i++) {
    const n = 1 + azar(30);
    const habitaciones = 1 + azar(10);
    const plan: PlanPrecio = {
      ajusteCentesimas: azar(6000) - 3000,
      ocupacionBase: 1 + azar(3),
      suplementoAdultoExtraCentavos: azar(3000),
      edadMaximaGratis: azar(18),
      suplementoNinoCentavos: azar(2000),
    };
    const d = calcularPrecio({
      noches: Array.from({ length: n }, (_, k) => ({ fecha: `n${k}`, precioCentavos: 1 + azar(5_000_000) })),
      plan,
      habitaciones,
      adultos: habitaciones + azar(10),
      edadesNinos: Array.from({ length: azar(5) }, () => azar(18)),
    });
    assert.ok(d.nochesDetalle.every((x) => Number.isInteger(x.centavos) && x.centavos >= 0));
    assert.equal(d.subtotal, d.nochesDetalle.reduce((s, x) => s + x.centavos, 0));
    assert.equal(d.total, d.subtotal + d.ivaValor + d.tasaMunicipal - d.descuentoCombo);
    // half-up exacto: 100·iva − 15·subtotal ∈ (−50, 50]. El empate (exactamente ,5 centavos) sube y da +50.
    const diferencia = 100 * d.ivaValor - 15 * d.subtotal;
    assert.ok(diferencia > -50 && diferencia <= 50, `IVA ${d.ivaValor} de ${d.subtotal}`);
    assert.equal(d.tasaMunicipal, 200 * n * habitaciones);
    assert.match(centavosAMoney(d.total), /^(0|[1-9][0-9]{0,8})\.[0-9]{2}$/);
  }
});
