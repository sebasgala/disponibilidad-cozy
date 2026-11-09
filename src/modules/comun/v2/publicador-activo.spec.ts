import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { PublicadorEventosService, resolverPublicadorActivo } from './publicador-eventos.service';

const INVALIDOS = [undefined, '', 'true', '1', 'false', '0', 'no', 'ambos', 'Monolito', ' monolito', 'backend', 'comun', 'event_bus'];
const MENSAJE = /PUBLICADOR_ACTIVO debe ser 'monolito' o 'event-bus'/;

describe('PUBLICADOR_ACTIVO del monolito (fase 9.4)', () => {
  it('acepta solo monolito o event-bus', () => {
    assert.equal(resolverPublicadorActivo({ PUBLICADOR_ACTIVO: 'monolito' }), 'monolito');
    assert.equal(resolverPublicadorActivo({ PUBLICADOR_ACTIVO: 'event-bus' }), 'event-bus');
  });

  it('rechaza cualquier otro valor, incluido vacío o sin definir', () => {
    for (const valor of INVALIDOS) {
      assert.throws(() => resolverPublicadorActivo({ PUBLICADOR_ACTIVO: valor }), MENSAJE, `valor ${JSON.stringify(valor)}`);
    }
  });

  it('con un valor inválido el arranque falla y no inicia el temporizador', () => {
    const anterior = process.env.PUBLICADOR_ACTIVO;
    try {
      process.env.PUBLICADOR_ACTIVO = 'true';
      const servicio = new PublicadorEventosService({} as never);
      assert.throws(() => servicio.onApplicationBootstrap(), MENSAJE);
      assert.equal((servicio as unknown as { temporizador?: unknown }).temporizador, undefined);
    } finally {
      if (anterior === undefined) delete process.env.PUBLICADOR_ACTIVO;
      else process.env.PUBLICADOR_ACTIVO = anterior;
    }
  });

  it('con event-bus el publicador del monolito queda inactivo', async () => {
    const anterior = process.env.PUBLICADOR_ACTIVO;
    try {
      process.env.PUBLICADOR_ACTIVO = 'event-bus';
      const servicio = new PublicadorEventosService({} as never);
      servicio.onApplicationBootstrap();
      assert.equal((servicio as unknown as { temporizador?: unknown }).temporizador, undefined);
      await servicio.onModuleDestroy();
    } finally {
      if (anterior === undefined) delete process.env.PUBLICADOR_ACTIVO;
      else process.env.PUBLICADOR_ACTIVO = anterior;
    }
  });
});
