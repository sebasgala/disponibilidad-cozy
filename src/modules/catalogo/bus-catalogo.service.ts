import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

// Eventos del catálogo para otros módulos (fase 8.0; en su esquema desde 9.0, E1). El catálogo los publica dentro de su
// transacción (outbox, catalogo.eventos_catalogo): si se deshace, el evento no existe; si se confirma, el consumidor
// (disponibilidad) lo procesará aunque esté caído en ese momento. El consumidor solo LEE esta tabla: lo que ya procesó lo
// guarda en su propio esquema (disponibilidad.eventos_catalogo_procesados).
export type TipoEventoCatalogo = 'catalogo.alojamiento.estado_cambiado' | 'catalogo.habitacion.estado_cambiado';

@Injectable()
export class BusCatalogoService {
  async publicar(manager: EntityManager, tipo: TipoEventoCatalogo, datos: Record<string, any>): Promise<void> {
    await manager.query(`INSERT INTO "catalogo"."eventos_catalogo" ("origen", "tipo", "datos") VALUES ('catalogo', $1, $2::jsonb)`, [tipo, JSON.stringify(datos)]);
  }
}
