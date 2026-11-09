// Qué alojamientos aceptan paquetes (combos) según el acuerdo B2B vigente (fase 8.0). El acuerdo es de reservas: el
// catálogo recibe esta política ya armada con la misma regla que valida la compra (null = no rige ningún acuerdo).
export interface PoliticaPaquetes {
  descuentoMaximo: number;
  todosLosDestinos: boolean;
  aceptaDestino(ciudad: string | null): boolean;
}
