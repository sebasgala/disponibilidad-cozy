// Lo que el catálogo necesita saber del inventario para buscar por fechas y mostrar las habitaciones (fase 8.0).
// El catálogo no lee las tablas de disponibilidad: recibe esta fuente como argumento (la implementa
// DisponibilidadPuerto y la conecta el módulo de consultas). Así el catálogo no depende del módulo de disponibilidad.

export interface PedidoOfertas {
  checkin: string;
  checkout: string;
  noches: number;
  cupos: number; // habitaciones pedidas: cada noche debe tener al menos estos cupos
}

export interface HabitacionParaPlanes {
  id: string;
  capacidadAdultos: number;
  mealPlan: string | null;
  cancellationType: string | null;
  precioBase: number;
}

export interface FuenteDisponibilidad {
  // Habitaciones con inventario en TODAS las noches del rango y cupo suficiente → suma del precio de las noches
  ofertas(pedido: PedidoOfertas): Promise<Map<string, number>>;
  // Cupos totales y libres de la primera noche con inventario desde `desde`
  proximaNoche(habitacionIds: string[], desde: string): Promise<Map<string, { cuposTotales: number; cupos: number }>>;
  // Planes de tarifa del contrato v2 (RatePlanV2) de cada habitación
  planesV2(habitaciones: HabitacionParaPlanes[]): Promise<Map<string, unknown[]>>;
}
