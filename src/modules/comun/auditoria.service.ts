import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

// Fase 9.0 (E1): cada módulo tiene su tabla de auditoría en su esquema (usuarios.auditoria_usuarios,
// catalogo.auditoria_catalogo, disponibilidad.auditoria_disponibilidad y reservas.auditoria_reservas).
export type ModuloAuditoria = 'usuarios' | 'catalogo' | 'disponibilidad' | 'reservas';

export interface RegistroAuditoria {
  // El módulo que hace el cambio: la fila va a SU tabla, con SU transacción
  modulo: ModuloAuditoria;
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string | number;
  antes?: Record<string, any> | null;
  despues?: Record<string, any> | null;
}

const INSERTAR: Record<ModuloAuditoria, string> = {
  usuarios: insertarEn('usuarios'),
  catalogo: insertarEn('catalogo'),
  disponibilidad: insertarEn('disponibilidad'),
  reservas: insertarEn('reservas'),
};

function insertarEn(modulo: ModuloAuditoria): string {
  return `INSERT INTO "${modulo}"."auditoria_${modulo}" ("usuarioId", "accion", "entidad", "entidadId", "antes", "despues") VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`;
}

// Escribe en la tabla de auditoría del módulo que hace el cambio. Siempre recibe el EntityManager de la transacción del
// cambio (que es del mismo módulo), así la fila y el cambio se guardan juntos o no se guarda ninguno.
@Injectable()
export class AuditoriaService {
  async registrar(manager: EntityManager, registro: RegistroAuditoria): Promise<void> {
    const sql = INSERTAR[registro.modulo];
    if (!sql) throw new Error(`Módulo de auditoría desconocido: ${String(registro.modulo)}`);
    await manager.query(sql, [
      registro.usuarioId,
      registro.accion,
      registro.entidad,
      String(registro.entidadId),
      registro.antes == null ? null : JSON.stringify(registro.antes),
      registro.despues == null ? null : JSON.stringify(registro.despues),
    ]);
  }
}
