import { PlanTarifa } from '../entities/plan-tarifa.entity';
import { aCentavos, centavosAMoney } from '../../comun/v2/dinero';
import { regimenDeMealPlan, Regimen } from '../../comun/v2/mapeos-v2';
import { aplicarAjuste, PlanPrecio } from '../../comun/v2/precios';

// Planes de tarifa del contrato v2 (RatePlanV2). Cada habitación vende:
//   ESTANDAR  el plan por defecto, derivado de la habitación (su precio por noche, mealPlan y cancellationType)
//   + los planes adicionales de la tabla planes_tarifa (ajuste sobre el precio del día, suplementos, otra política)
export const PLAN_ESTANDAR = 'ESTANDAR';

export type ModeloPago = 'PREPAGO' | 'PAGO_EN_HOTEL' | 'GARANTIA_TARJETA';

export interface PoliticaCancelacion {
  esReembolsable: boolean;
  horasLimiteCancelacion?: number;
  penalidadFueraDeVentanaPorcentaje?: number;
  descripcion: string;
}

export interface PlanV2 {
  codigo: string;
  nombre: string;
  regimen: Regimen;
  modeloPago: ModeloPago;
  politicaCancelacion: PoliticaCancelacion;
  precio: PlanPrecio;
  esPlanPorDefecto: boolean;
}

interface HabitacionConPlan {
  capacidadAdultos: number;
  mealPlan: string | null;
  cancellationType: string | null;
}

function politica(esReembolsable: boolean, horas?: number | null, penalidad?: number | null): PoliticaCancelacion {
  if (!esReembolsable) return { esReembolsable: false, descripcion: 'Tarifa no reembolsable.' };
  return {
    esReembolsable: true,
    ...(horas !== null && horas !== undefined && { horasLimiteCancelacion: horas }),
    ...(penalidad !== null && penalidad !== undefined && { penalidadFueraDeVentanaPorcentaje: penalidad }),
    descripcion: horas ? `Cancelación gratuita hasta ${horas} horas antes de la llegada.` : 'Cancelación gratuita.',
  };
}

export function planEstandar(h: HabitacionConPlan): PlanV2 {
  return {
    codigo: PLAN_ESTANDAR,
    nombre: 'Tarifa estándar',
    regimen: regimenDeMealPlan(h.mealPlan) ?? 'SOLO_HABITACION',
    modeloPago: 'PREPAGO',
    politicaCancelacion: politica(h.cancellationType === 'free_cancellation'),
    precio: { ajusteCentesimas: 0, ocupacionBase: Math.max(1, Math.min(h.capacidadAdultos, 2)), suplementoAdultoExtraCentavos: 0, edadMaximaGratis: 17, suplementoNinoCentavos: 0 },
    esPlanPorDefecto: true,
  };
}

export function planDeFila(p: PlanTarifa): PlanV2 {
  return {
    codigo: p.codigo,
    nombre: p.nombre,
    regimen: p.regimen as Regimen,
    modeloPago: p.modeloPago as ModeloPago,
    politicaCancelacion: politica(p.esReembolsable, p.horasLimiteCancelacion, p.penalidadPorcentaje),
    precio: {
      ajusteCentesimas: Math.round(Number(p.ajustePorcentaje) * 100),
      ocupacionBase: p.ocupacionBase,
      suplementoAdultoExtraCentavos: aCentavos(Number(p.suplementoAdultoExtra)),
      edadMaximaGratis: p.edadMaximaGratisNinos,
      suplementoNinoCentavos: aCentavos(Number(p.suplementoNino)),
    },
    esPlanPorDefecto: false,
  };
}

// ESTANDAR primero y luego los adicionales activos, por código
export function planesDeHabitacion(h: HabitacionConPlan, adicionales: PlanTarifa[]): PlanV2[] {
  return [planEstandar(h), ...adicionales.filter((p) => p.activo).sort((a, b) => a.codigo.localeCompare(b.codigo)).map(planDeFila)];
}

// RatePlanV2 del contrato. El precio base es el de la habitación con el ajuste del plan aplicado.
export function aRatePlanV2(plan: PlanV2, precioBaseCentavos: number) {
  return {
    codigo: plan.codigo,
    nombre: plan.nombre,
    regimen: plan.regimen,
    modeloPago: plan.modeloPago,
    politicaCancelacion: plan.politicaCancelacion,
    ocupacionBase: plan.precio.ocupacionBase,
    precioBaseNoche: centavosAMoney(aplicarAjuste(precioBaseCentavos, plan.precio.ajusteCentesimas)),
    ...(plan.precio.suplementoAdultoExtraCentavos > 0 && { suplementoAdultoExtra: centavosAMoney(plan.precio.suplementoAdultoExtraCentavos) }),
    politicaNinos: { edadMaximaGratis: plan.precio.edadMaximaGratis, suplementoNino: centavosAMoney(plan.precio.suplementoNinoCentavos) },
    impuestosIncluidos: false,
    esPlanPorDefecto: plan.esPlanPorDefecto,
  };
}
