import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { calcularNoches } from '../comun/alojamientos-consulta.utils';
import { DisponibilidadDiaria } from './entities/disponibilidad-diaria.entity';
import { EstadoRetencion, RetencionCupos } from './entities/retencion-cupos.entity';
import { DisponibilidadService } from './disponibilidad.service';

export interface PedidoCupos {
  ordenId: string;
  habitacionId: string;
  checkin: string;
  checkout: string;
  cantidad: number;
}

export interface NocheRetenida {
  fecha: string;
  cupos: number; // los que había antes de esta retención
  precio: number;
}

// ok = false: no se retuvo nada; `motivo` dice por qué y `remanentes`, el menor cupo de las noches
export interface ResultadoReserva {
  ok: boolean;
  noches: NocheRetenida[];
  repetida: boolean;
  motivo: 'SIN_INVENTARIO' | 'SIN_CUPO' | null;
  remanentes: number;
}

export type ResultadoLiberacion = 'LIBERADA' | 'YA_LIBERADA' | 'SIN_RETENCION';

// CONFIRMADA: era provisional y ya no vence. YA_CONFIRMADA: ya lo estaba (repetición, o retención de antes de 8.4).
// LIBERADA: se liberó antes (compensación o vencimiento) y no se puede confirmar. SIN_RETENCION: la orden no retiene nada.
export type ResultadoConfirmacion = 'CONFIRMADA' | 'YA_CONFIRMADA' | 'LIBERADA' | 'SIN_RETENCION';

// Lo que la saga necesita de la retención confirmada para avisar el stock de sus noches
export interface RetencionConfirmada {
  resultado: ResultadoConfirmacion;
  checkin: string | null;
  checkout: string | null;
}

// Minutos que vive una retención provisional (decisión 3 de 8.4)
export const MINUTOS_RETENCION_PROVISIONAL = 15;

// Retenciones de cupos por orden (fase 8.0): la única forma en que reservas toca el inventario.
//   ReservarCupos(orden, habitación, noches, cantidad)  bloquea las noches (SELECT … FOR UPDATE, en orden de fecha),
//                                                         comprueba el cupo, lo descuenta y guarda la retención.
//   LiberarCupos(orden)                                   devuelve exactamente lo retenido y marca la retención.
// Las dos son idempotentes por orden: repetirlas no descuenta ni devuelve dos veces. Hoy corren en la transacción de
// la orden (`manager`); con reservas y disponibilidad separados serán los pasos de la saga y su compensación.
@Injectable()
export class CuposService {
  constructor(private readonly disponibilidad: DisponibilidadService) {}

  // venceEn: null para una retención que nace confirmada (la usan las pruebas de base de 8.0); la saga pasa el vencimiento
  async reservar(manager: EntityManager, pedido: PedidoCupos, venceEn: Date | null = null): Promise<ResultadoReserva> {
    const { ordenId, habitacionId, checkin, checkout, cantidad } = pedido;
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error(`Cantidad de cupos inválida: ${cantidad}`);

    const existente = await this.retencion(manager, ordenId);
    if (existente) {
      const misma = existente.habitacionId === habitacionId && existente.checkin === checkin && existente.checkout === checkout && existente.cantidad === cantidad;
      if (!misma) throw new Error(`La orden ${ordenId} ya retiene otros cupos (${existente.habitacionId} ${existente.checkin}→${existente.checkout} × ${existente.cantidad})`);
      if (existente.estado === EstadoRetencion.LIBERADA) throw new Error(`La retención de la orden ${ordenId} ya se liberó: no se vuelve a reservar`);
      const filas = await this.disponibilidad.bloquearNoches(manager, habitacionId, checkin, checkout);
      // Ya descontada: las noches devuelven el cupo actual más lo que esta orden retiene
      return { ok: true, repetida: true, motivo: null, remanentes: Math.min(...filas.map((f) => f.cupos)), noches: filas.map((f) => ({ fecha: f.fecha, cupos: f.cupos + cantidad, precio: Number(f.precio) })) };
    }

    const filas = await this.disponibilidad.bloquearNoches(manager, habitacionId, checkin, checkout);
    if (filas.length < calcularNoches(checkin, checkout)) return { ok: false, repetida: false, noches: [], motivo: 'SIN_INVENTARIO', remanentes: 0 };
    const remanentes = Math.min(...filas.map((f) => f.cupos));
    if (remanentes < cantidad) return { ok: false, repetida: false, noches: [], motivo: 'SIN_CUPO', remanentes };

    const resultado = await manager
      .createQueryBuilder()
      .update(DisponibilidadDiaria)
      .set({ cupos: () => `cupos - ${cantidad}` })
      .where('habitacionId = :habitacionId', { habitacionId })
      .andWhere('fecha >= :checkin AND fecha < :checkout', { checkin, checkout })
      .andWhere('cupos >= :cantidad', { cantidad })
      .execute();
    if (resultado.affected !== filas.length) {
      // No debería pasar con las filas bloqueadas; si pasa, la transacción se deshace entera.
      throw new Error(`Se esperaban ${filas.length} noches con cupos y se actualizaron ${resultado.affected}`);
    }
    await manager.insert(RetencionCupos, { ordenId, habitacionId, checkin, checkout, cantidad, estado: EstadoRetencion.RETENIDA, venceEn });
    return { ok: true, repetida: false, motivo: null, remanentes, noches: filas.map((f) => ({ fecha: f.fecha, cupos: f.cupos, precio: Number(f.precio) })) };
  }

  async liberar(manager: EntityManager, ordenId: string): Promise<ResultadoLiberacion> {
    const retencion = await this.retencion(manager, ordenId);
    if (!retencion) return 'SIN_RETENCION';
    if (retencion.estado === EstadoRetencion.LIBERADA) return 'YA_LIBERADA';
    // Mismo orden de bloqueo que la reserva y la edición del admin (por fecha): evita bloqueos cruzados
    await this.disponibilidad.bloquearNoches(manager, retencion.habitacionId, retencion.checkin, retencion.checkout);
    await manager
      .createQueryBuilder()
      .update(DisponibilidadDiaria)
      .set({ cupos: () => `cupos + ${retencion.cantidad}` })
      .where('habitacionId = :habitacionId', { habitacionId: retencion.habitacionId })
      .andWhere('fecha >= :checkin AND fecha < :checkout', { checkin: retencion.checkin, checkout: retencion.checkout })
      .execute();
    await manager.update(RetencionCupos, { ordenId }, { estado: EstadoRetencion.LIBERADA, liberadaEn: new Date() });
    return 'LIBERADA';
  }

  // Confirma una retención provisional: deja de vencer. Idempotente. No toca cupos.
  async confirmar(manager: EntityManager, ordenId: string): Promise<RetencionConfirmada> {
    const retencion = await this.retencion(manager, ordenId);
    if (!retencion) return { resultado: 'SIN_RETENCION', checkin: null, checkout: null };
    if (retencion.estado === EstadoRetencion.LIBERADA) return { resultado: 'LIBERADA', checkin: retencion.checkin, checkout: retencion.checkout };
    if (retencion.venceEn === null) return { resultado: 'YA_CONFIRMADA', checkin: retencion.checkin, checkout: retencion.checkout };
    // Aunque haya pasado venceEn, si el barrido no la liberó los cupos siguen descontados: se confirma igual
    await manager.update(RetencionCupos, { ordenId }, { venceEn: null, confirmadaEn: new Date() });
    return { resultado: 'CONFIRMADA', checkin: retencion.checkin, checkout: retencion.checkout };
  }

  // Órdenes con una retención provisional vencida (para el barrido)
  async vencidas(manager: EntityManager, ahora: Date, limite: number): Promise<string[]> {
    const filas = await manager
      .getRepository(RetencionCupos)
      .createQueryBuilder('r')
      .select('r.ordenId', 'ordenId')
      .where('r.estado = :estado', { estado: EstadoRetencion.RETENIDA })
      .andWhere('r.venceEn IS NOT NULL AND r.venceEn < :ahora', { ahora })
      .orderBy('r.venceEn', 'ASC')
      .limit(limite)
      .getRawMany<{ ordenId: string }>();
    return filas.map((f) => f.ordenId);
  }

  // Libera la retención solo si sigue provisional y vencida (se vuelve a mirar con la fila bloqueada: la saga pudo
  // confirmarla entre medio). No avisa stock: Booking nunca supo de una retención sin confirmar.
  async liberarSiVencida(manager: EntityManager, ordenId: string, ahora: Date): Promise<boolean> {
    const retencion = await this.retencion(manager, ordenId);
    if (!retencion || retencion.estado !== EstadoRetencion.RETENIDA || retencion.venceEn === null || retencion.venceEn.getTime() >= ahora.getTime()) return false;
    return (await this.liberar(manager, ordenId)) === 'LIBERADA';
  }

  // La fila de la retención se bloquea: dos liberaciones (o reservas) de la misma orden pasan de a una
  private retencion(manager: EntityManager, ordenId: string): Promise<RetencionCupos | null> {
    return manager.getRepository(RetencionCupos).createQueryBuilder('r').setLock('pessimistic_write').where('r.ordenId = :ordenId', { ordenId }).getOne();
  }
}
