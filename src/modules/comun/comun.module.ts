import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditoriaService } from './auditoria.service';
import { ErroresBaseDatosFilter } from './problems/errores-base-datos.filter';
import { EventosService } from './v2/eventos.service';
import { PublicadorEventosService } from './v2/publicador-eventos.service';
import { Reloj } from './v2/reloj';

// Lo transversal a los dominios (fase 8.0): auditoría (cada fila en la tabla del módulo que hace el cambio, desde 9.0),
// feed de eventos del contrato v2 (emitir en la outbox de cada dominio y el publicador único que numera y escribe
// comun.feed_eventos) y reloj. Global: los cuatro dominios lo usan sin importarlo. Desde 9.0 (E1) no tiene tablas en public:
// las suyas (el feed) están en el esquema comun y los eventos del catálogo pasaron al catálogo (BusCatalogoService).
@Global()
@Module({
  providers: [
    AuditoriaService,
    EventosService,
    PublicadorEventosService,
    Reloj,
    // Global: restricciones de PostgreSQL (check, foreign key, unique) => 400/409 problem+json, nunca 500.
    { provide: APP_FILTER, useClass: ErroresBaseDatosFilter },
  ],
  exports: [AuditoriaService, EventosService, PublicadorEventosService, Reloj],
})
export class ComunModule {}

// Servicios transversales para los procesos de dominio separados (fase 9.2): auditoría, emisión en outbox del propio
// dominio, reloj y filtro de errores de base de datos, SIN PublicadorEventosService (que corre en comun).
@Global()
@Module({
  providers: [
    AuditoriaService,
    EventosService,
    Reloj,
    { provide: APP_FILTER, useClass: ErroresBaseDatosFilter },
  ],
  exports: [AuditoriaService, EventosService, Reloj],
})
export class ComunDominioModule {}
