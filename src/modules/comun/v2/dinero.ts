// Dinero y paginación del contrato v2.
// `Money` es un string decimal exacto con dos decimales ("560.00"), nunca un number. Todo cálculo se hace en
// centavos enteros (aquí solo se convierte): los flotantes binarios no representan 0.10 con exactitud.

export type Money = string;

const PATRON_MONEY = /^(0|[1-9][0-9]{0,8})\.[0-9]{2}$/;

// number con a lo sumo dos decimales (lo que guarda numeric(10,2)) a centavos enteros
export const aCentavos = (valor: number): number => Math.round(valor * 100);

export function centavosAMoney(centavos: number): Money {
  if (!Number.isInteger(centavos) || centavos < 0) throw new Error(`Importe inválido: ${centavos} centavos`);
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

export const dinero = (valor: number): Money => centavosAMoney(aCentavos(valor));

export const esMoney = (valor: unknown): valor is Money => typeof valor === 'string' && PATRON_MONEY.test(valor);

export function moneyACentavos(valor: Money): number {
  const [enteros, decimales] = valor.split('.');
  return Number(enteros) * 100 + Number(decimales);
}

// Precio medio por noche de una estancia, redondeado half-up a centavos
export const centavosPorNoche = (totalCentavos: number, noches: number): number => Math.floor((totalCentavos * 2 + noches) / (noches * 2));

export interface MetadataPagina {
  total_results: number;
  page: number;
  limit: number;
  total_pages: number;
  has_next: boolean;
}

export function metadataPagina(totalResultados: number, page: number, limit: number): MetadataPagina {
  const totalPaginas = Math.ceil(totalResultados / limit);
  return { total_results: totalResultados, page, limit, total_pages: totalPaginas, has_next: page < totalPaginas };
}
