import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';
import { esCampoSensible, redactar, REDACTADO, registrarV2, resumenError } from './registro-v2';

const contrato = load(readFileSync(resolve(process.cwd(), 'contracts/v2/alojamientos-openapi-v2.yaml'), 'utf8'));

// Todos los nombres de propiedad marcados x-pii / x-secret en cualquier parte del contrato
function camposMarcados(nodo: unknown, salida = new Set<string>()): Set<string> {
  if (Array.isArray(nodo)) nodo.forEach((n) => camposMarcados(n, salida));
  else if (nodo && typeof nodo === 'object') {
    const obj = nodo as Record<string, unknown>;
    const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
    if (props && typeof props === 'object') {
      for (const [nombre, def] of Object.entries(props)) if (def && (def['x-pii'] === true || def['x-secret'] === true)) salida.add(nombre);
    }
    Object.values(obj).forEach((v) => camposMarcados(v, salida));
  }
  return salida;
}

test('Todo campo x-pii / x-secret del contrato está en la lista de campos sensibles', () => {
  const marcados = [...camposMarcados(contrato)];
  assert.ok(marcados.length >= 10, `el contrato marca ${marcados.length} campos`);
  const faltan = marcados.filter((c) => !esCampoSensible(c));
  assert.deepEqual(faltan, []);
});

test('redactar tapa los sensibles en cualquier profundidad y no toca el original', () => {
  const original = {
    id: 'ORD-1',
    huesped: { nombreCompleto: 'Ana Pérez', email: 'ana@correo.ec' },
    ocupantes: [{ full_name: 'Luis', edad: 30 }],
    claveAccesoDigital: 'PIN-1',
    cabeceras: { Authorization: 'Bearer abc', 'X-API-Key': 'k' },
    total: '10.00',
  };
  const copia = redactar(original) as Record<string, unknown>;
  const texto = JSON.stringify(copia);
  for (const secreto of ['Ana', 'ana@correo.ec', 'Luis', 'PIN-1', 'Bearer abc']) assert.ok(!texto.includes(secreto), `se coló ${secreto}`);
  assert.ok(texto.includes('ORD-1') && texto.includes('10.00'));
  assert.equal(original.huesped.email, 'ana@correo.ec');
  assert.equal(copia.claveAccesoDigital as string, REDACTADO);
});

test('resumenError no incluye el mensaje (puede traer valores de la fila)', () => {
  const error = Object.assign(new Error('duplicate key value (email)=(ana@correo.ec)'), { name: 'QueryFailedError', code: '23505' });
  const resumen = JSON.stringify(resumenError(error));
  assert.ok(!resumen.includes('ana@correo.ec') && !resumen.includes('duplicate'));
  assert.ok(resumen.includes('QueryFailedError') && resumen.includes('23505'));
});

test('registrarV2 escribe una línea JSON y redacta los datos', () => {
  const originalOut = process.stdout.write.bind(process.stdout);
  let capturado = '';
  (process.stdout as { write: unknown }).write = (c: string) => {
    capturado += c;
    return true;
  };
  try {
    registrarV2('info', 'prueba', { correlationId: 'abc-1234', email: 'x@y.ec', anidado: { telefono: '0999999999' } });
  } finally {
    (process.stdout as { write: unknown }).write = originalOut;
  }
  const linea = JSON.parse(capturado.trim());
  assert.equal(linea.evento, 'prueba');
  assert.equal(linea.correlationId, 'abc-1234');
  assert.ok(!capturado.includes('x@y.ec') && !capturado.includes('0999999999'));
});
