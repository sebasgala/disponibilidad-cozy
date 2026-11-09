// Traducciones entre el modelo de Cozy y el vocabulario del contrato v2.

export type Regimen = 'SOLO_HABITACION' | 'DESAYUNO_INCLUIDO' | 'MEDIA_PENSION' | 'PENSION_COMPLETA' | 'TODO_INCLUIDO';

// mealPlan de Cozy -> régimen del contrato. MEDIA_PENSION y PENSION_COMPLETA no existen en Cozy.
const REGIMEN_POR_MEAL_PLAN: Record<string, Regimen> = {
  room_only: 'SOLO_HABITACION',
  breakfast_included: 'DESAYUNO_INCLUIDO',
  all_inclusive: 'TODO_INCLUIDO',
};

export const regimenDeMealPlan = (mealPlan: string | null): Regimen | undefined => (mealPlan ? REGIMEN_POR_MEAL_PLAN[mealPlan] : undefined);

export const mealPlanDeRegimen = (regimen: Regimen): string | undefined =>
  Object.entries(REGIMEN_POR_MEAL_PLAN).find(([, valor]) => valor === regimen)?.[0];

export interface PoliticaCancelacionV2 {
  esReembolsable: boolean;
  descripcion: string;
}

// cancellationType de Cozy -> política del contrato. Cozy no guarda ventanas de horas, así que no se inventan.
export function politicaDeCancelacion(cancellationType: string | null): PoliticaCancelacionV2 {
  return cancellationType === 'free_cancellation'
    ? { esReembolsable: true, descripcion: 'Cancelación gratuita.' }
    : { esReembolsable: false, descripcion: 'Tarifa no reembolsable.' };
}

// Tipos de propiedad (taxonomía de /alojamientos/categorias)
export const CATEGORIAS = [
  { tipo: 'HOTEL', id: 'cat-hotel', nombre: 'Hotel', slug: 'hotel', descripcion: 'Hotel con servicio de recepción y habitaciones.' },
  { tipo: 'RESORT', id: 'cat-resort', nombre: 'Resort', slug: 'resort', descripcion: 'Complejo turístico con servicios incluidos.' },
  { tipo: 'APARTAMENTO', id: 'cat-apartamento', nombre: 'Apartamento', slug: 'apartamento', descripcion: 'Apartamento turístico.' },
  { tipo: 'HOSTAL', id: 'cat-hostal', nombre: 'Hostal', slug: 'hostal', descripcion: 'Alojamiento económico con servicios básicos.' },
  { tipo: 'HOSTERIA', id: 'cat-hosteria', nombre: 'Hostería', slug: 'hosteria', descripcion: 'Hostería de ambiente familiar.' },
] as const;
