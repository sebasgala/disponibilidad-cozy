import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CatalogoPuerto } from '../catalogo/catalogo.puerto';
import { DisponibilidadDiaria } from './entities/disponibilidad-diaria.entity';
import { CONEXION } from '../../database/conexiones';

export interface RepartoHuespedes {
  habitaciones: number;
  adultosPorHabitacion: number;
  ninosPorHabitacion: number;
}

export interface CriterioDisponibilidad {
  alojamientoId: number;
  habitacionId?: string; // para limitar el cálculo a una sola habitación
  checkin: string;
  checkout: string;
  noches: number;
  reparto: RepartoHuespedes;
}

export interface HabitacionDisponible {
  id: string;
  nombre: string;
  tipo: string;
  mealPlan: string | null;
  cancellationType: string | null;
  capacidadAdultos: number;
  capacidadNinos: number;
  total: number; // por habitación y por toda la estancia: suma de las noches
  cuposMinimos: number;
  noches: { date: string; price: number }[];
}

// Fuente única del cálculo de precio y disponibilidad v1: la usan /availability y las órdenes v1 (preview).
// Las habitaciones (activas y donde caben los huéspedes) las da el catálogo; las noches, este dominio.
@Injectable()
export class DisponibilidadService {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly catalogo: CatalogoPuerto,
  ) {}

  // Habitaciones activas libres TODAS las noches de [checkin, checkout), con cupos >= habitaciones pedidas
  // y donde caben los huéspedes. El total es la suma del precio de cada noche.
  async habitacionesDisponibles(criterio: CriterioDisponibilidad): Promise<HabitacionDisponible[]> {
    const habitaciones = (await this.catalogo.habitaciones({ alojamientoId: criterio.alojamientoId, soloActivas: true, ...(criterio.habitacionId && { ids: [criterio.habitacionId] }) })).filter(
      (h) => h.capacidadAdultos >= criterio.reparto.adultosPorHabitacion && h.capacidadNinos >= criterio.reparto.ninosPorHabitacion,
    );
    if (habitaciones.length === 0) return [];
    const filas: { habitacionId: string; total: string; cuposMinimos: number; desglose: { date: string; price: number }[] }[] = await this.dataSource.query(
      `SELECT d."habitacionId", SUM(d."precio") AS "total", MIN(d."cupos") AS "cuposMinimos",
              json_agg(json_build_object('date', d."fecha", 'price', d."precio") ORDER BY d."fecha") AS "desglose"
       FROM "disponibilidad"."disponibilidad_diaria" d
       WHERE d."habitacionId" = ANY($1::uuid[]) AND d."fecha" >= $2 AND d."fecha" < $3 AND d."cupos" >= $4
       GROUP BY d."habitacionId" HAVING COUNT(*) = $5`,
      [habitaciones.map((h) => h.id), criterio.checkin, criterio.checkout, criterio.reparto.habitaciones, criterio.noches],
    );
    const porId = new Map(habitaciones.map((h) => [h.id, h]));
    return filas
      .map((fila) => {
        const h = porId.get(fila.habitacionId);
        return {
          id: h.id,
          nombre: h.nombre,
          tipo: h.tipo,
          mealPlan: h.mealPlan,
          cancellationType: h.cancellationType,
          capacidadAdultos: h.capacidadAdultos,
          capacidadNinos: h.capacidadNinos,
          total: Number(fila.total),
          cuposMinimos: Number(fila.cuposMinimos),
          noches: fila.desglose,
        };
      })
      .sort((a, b) => a.total - b.total || a.nombre.localeCompare(b.nombre));
  }

  // Bloqueo pesimista de escritura (SELECT ... FOR UPDATE) de las noches de una habitación.
  // Se bloquean en orden de fecha para que dos transacciones no se crucen (deadlock).
  bloquearNoches(manager: EntityManager, habitacionId: string, checkin: string, checkout: string): Promise<DisponibilidadDiaria[]> {
    return manager
      .getRepository(DisponibilidadDiaria)
      .createQueryBuilder('d')
      .setLock('pessimistic_write')
      .where('d.habitacionId = :habitacionId', { habitacionId })
      .andWhere('d.fecha >= :checkin AND d.fecha < :checkout', { checkin, checkout })
      .orderBy('d.fecha', 'ASC')
      .getMany();
  }
}
