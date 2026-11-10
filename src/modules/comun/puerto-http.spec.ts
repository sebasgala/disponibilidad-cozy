import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { llamarPuertoHttp } from './puerto-http';

test('llamarPuertoHttp: parsea JSON cuando el Content-Type es application/json', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ status: 'ok', valor: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }) as unknown as typeof fetch;

    const res = await llamarPuertoHttp<{ status: string; valor: number }>(
      'http://dummy-internal-service',
      '/test',
    );
    assert.deepEqual(res, { status: 'ok', valor: 42 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('llamarPuertoHttp: devuelve texto plano sin fallar con SyntaxError si Content-Type no es JSON', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response('CONFIRMADA', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }) as unknown as typeof fetch;

    const res = await llamarPuertoHttp<string>(
      'http://dummy-internal-service',
      '/cupos/confirmar',
    );
    assert.equal(res, 'CONFIRMADA');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
