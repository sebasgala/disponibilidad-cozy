import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Cotizacion } from '../entities/cotizacion.entity';
import { CatalogoPuerto, HabitacionCatalogo } from '../../catalogo/catalogo.puerto';
import { PlanTarifa } from '../entities/plan-tarifa.entity';
import { RestriccionDia } from '../entities/restriccion-dia.entity';
import { aCentavos, centavosAMoney } from '../../comun/v2/dinero';
import { CotizarV2Dto, OpcionesDisponibilidadV2Query } from './dto/disponibilidad-v2.dto';
import { exigirUsd, validarEstancia } from '../../comun/v2/estancia';
import { PlanV2, planesDeHabitacion, PLAN_ESTANDAR } from './planes';
import { calcularPrecio, DesglosePrecio, repartir } from '../../comun/v2/precios';
import { noEncontrado, ProblemaV2Exception, reglaDeNegocio } from '../../comun/v2/problemas-v2';
import { Reloj, vigenteHasta } from '../../comun/v2/reloj';
import { evaluarRestricciones, RestriccionNoche } from './restricciones';
import { CONEXION } from '../../../database/conexiones';

// Edad que se supone para un niño sin edad informada: la más alta, así un suplemento por edad nunca se omite
const EDAD_DESCONOCIDA = 17;

export interface Ocupacion {
  adultos: number;
  ninos: number;
  edadesNinos: number[];
}

// Lo que reservas lee de una cotización para fijar el precio de la orden
export type DatosCotizacion = Pick<
  Cotizacion,
  'id' | 'alojamientoId' | 'habitacionId' | 'fechaInicio' | 'fechaFin' | 'cantidadHabitaciones' | 'planTarifaCodigo' | 'ocupantes' | 'validaHasta' | 'desglose'
>;

type CapacidadHabitacion = Pick<HabitacionCatalogo, 'codigo' | 'capacidadAdultos' | 'capacidadNinos'>;

interface Noche {
  fecha: string;
  cupos: number;
  precioCentavos: number;
}

// Niños: `ninos` o, si falta, la cantidad de edades. Si vienen los dos, tienen que coincidir.
export function calcularOcupantes(o: { adultos: number; ninos?: number; edadesNinos?: number[] }, campo: string): Ocupacion {
  const ninos = o.ninos ?? o.edadesNinos?.length ?? 0;
  if (o.edadesNinos && o.edadesNinos.length !== ninos) {
    throw reglaDeNegocio('VALIDATION_FAILED', 'edadesNinos debe traer una edad por cada niño.', [
      { name: `${campo}.edadesNinos`, reason: `trae ${o.edadesNinos.length} edades para ${ninos} niños` },
    ]);
  }
  const edadesNinos = [...(o.edadesNinos ?? []), ...Array(Math.max(0, ninos - (o.edadesNinos?.length ?? 0))).fill(EDAD_DESCONOCIDA)];
  return { adultos: o.adultos, ninos, edadesNinos };
}

function cabeEnHabitacion(h: CapacidadHabitacion, o: Ocupacion, habitaciones: number): boolean {
  return o.adultos >= habitaciones && Math.max(...repartir(o.adultos, habitaciones)) <= h.capacidadAdultos && Math.max(...repartir(o.ninos, habitaciones)) <= h.capacidadNinos;
}

export function validarCapacidadHabitacion(h: CapacidadHabitacion, o: Ocupacion, habitaciones: number): void {
  if (o.adultos < habitaciones) {
    throw reglaDeNegocio('VALIDATION_FAILED', 'Cada habitación necesita al menos un adulto.', [{ name: 'ocupantes.adultos', reason: `${o.adultos} adultos para ${habitaciones} habitaciones` }]);
  }
  if (!cabeEnHabitacion(h, o, habitaciones)) {
    throw reglaDeNegocio(
      'CAPACITY_EXCEEDED',
      `${o.adultos} adultos y ${o.ninos} niños no caben en ${habitaciones} habitación(es) '${h.codigo}' (máximo ${h.capacidadAdultos} adultos y ${h.capacidadNinos} niños por habitación).`,
      [{ name: 'ocupantes', reason: 'supera la capacidad de la habitación' }],
    );
  }
}

export function construirDesgloseV2(d: DesglosePrecio) {
  const iva = centavosAMoney(d.ivaValor);
  const tasa = centavosAMoney(d.tasaMunicipal);
  return {
    precioNoche: centavosAMoney(d.precioNocheCentavos),
    subtotal: centavosAMoney(d.subtotal),
    ivaPorcentaje: d.ivaPorcentaje,
    ivaValor: iva,
    iva15Pct: iva, // deprecado en el contrato (se mantiene hasta la v3): igual a ivaValor
    tasaMunicipal: tasa,
    descuentoCombo: centavosAMoney(d.descuentoCombo),
    totalPagar: centavosAMoney(d.total),
    impuestos: [
      { codigo: 'IVA', nombre: 'IVA', porcentaje: d.ivaPorcentaje, monto: iva, incluidoEnPrecio: false },
      { codigo: 'TASA_MUNICIPAL', nombre: 'Tasa municipal', monto: tasa, incluidoEnPrecio: false },
    ],
    nochesDetalle: d.nochesDetalle.map((n) => ({ fecha: n.fecha, precio: centavosAMoney(n.centavos) })),
  };
}

// Disponibilidad y cotización del contrato v2 (§3 y §4.1):
//   POST /alojamientos/availability       una habitación y un plan: precio desglosado y congelado 30 min (cotizacionId)
//   GET  /alojamientos/{id}/availability  todas las habitaciones y planes con cupo y precio (informativo, sin cotización)
// La cotización NO retiene cupo: el cupo se descuenta recién en orders/create (fase 4).
@Injectable()
export class DisponibilidadV2Service {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly reloj: Reloj,
    private readonly catalogo: CatalogoPuerto,
  ) {}

  // ───────────────────────── POST /alojamientos/availability ─────────────────────────
  async cotizar(dto: CotizarV2Dto) {
    const noches = validarEstancia(dto.fechaInicio, dto.fechaFin);
    exigirUsd(dto.currency);
    const habitaciones = dto.cantidadHabitaciones ?? 1;
    // Sin ocupantes se cotiza la ocupación mínima: un adulto por habitación
    const ocupacion = this.ocupacion(dto.ocupantes ?? { adultos: habitaciones }, 'ocupantes');

    const alojamiento = await this.alojamientoActivo(dto.alojamientoId);
    const habitacion = await this.catalogo.habitacionActiva(alojamiento.id, dto.tipoHabitacionCodigo);
    if (!habitacion) throw noEncontrado(`El alojamiento '${dto.alojamientoId}' no tiene el tipo de habitación '${dto.tipoHabitacionCodigo}'.`);

    const planes = await this.planes([habitacion]);
    const codigoPlan = dto.planTarifaCodigo ?? PLAN_ESTANDAR;
    const plan = planes.get(habitacion.id).find((p) => p.codigo === codigoPlan);
    if (!plan) throw noEncontrado(`La habitación '${habitacion.codigo}' no tiene el plan de tarifa '${codigoPlan}'.`);
    if (dto.regimenSeleccionado && dto.regimenSeleccionado !== plan.regimen) {
      throw reglaDeNegocio('VALIDATION_FAILED', `El plan ${plan.codigo} ofrece ${plan.regimen}, no ${dto.regimenSeleccionado}.`, [
        { name: 'regimenSeleccionado', reason: `el plan ${plan.codigo} es ${plan.regimen}` },
      ]);
    }
    this.exigirCapacidad(habitacion, ocupacion, habitaciones);

    const fechaFin = dto.fechaFin;
    const [inventario, restricciones] = await Promise.all([this.noches([habitacion.id], noches), this.restricciones([habitacion.id], [...noches, fechaFin])]);
    const delaHabitacion = inventario.get(habitacion.id) ?? [];
    if (delaHabitacion.length < noches.length) {
      throw new ProblemaV2Exception(409, 'OUT_OF_STOCK', `No hay disponibilidad cargada para '${habitacion.codigo}' en todas las noches pedidas.`);
    }
    const ahora = this.reloj.ahora();
    const violacion = evaluarRestricciones(noches, fechaFin, restricciones.get(habitacion.id) ?? new Map(), ahora);
    if (violacion) {
      throw reglaDeNegocio('RESTRICTION_VIOLATED', violacion.detalle, [{ name: 'fechaInicio', reason: `${violacion.restriccion} (${violacion.fecha})` }], {
        restriccion: violacion.restriccion,
      });
    }
    const remanentes = Math.min(...delaHabitacion.map((n) => n.cupos));
    if (remanentes < habitaciones) {
      throw new ProblemaV2Exception(409, 'OUT_OF_STOCK', `Quedan ${remanentes} habitaciones '${habitacion.codigo}' para esas fechas y se pidieron ${habitaciones}.`);
    }

    const desglose = calcularPrecio({
      noches: delaHabitacion.map(({ fecha, precioCentavos }) => ({ fecha, precioCentavos })),
      plan: plan.precio,
      habitaciones,
      adultos: ocupacion.adultos,
      edadesNinos: ocupacion.edadesNinos,
    });
    const desglosePrecio = this.aDesgloseV2(desglose);
    const validaHasta = vigenteHasta(ahora);
    const planCotizado = { codigo: plan.codigo, nombre: plan.nombre, regimen: plan.regimen, modeloPago: plan.modeloPago, politicaCancelacion: plan.politicaCancelacion };
    const cotizacion = await this.dataSource.getRepository(Cotizacion).save({
      alojamientoId: alojamiento.id,
      habitacionId: habitacion.id,
      planTarifaCodigo: plan.codigo,
      fechaInicio: dto.fechaInicio,
      fechaFin,
      cantidadHabitaciones: habitaciones,
      ocupantes: { adultos: ocupacion.adultos, ninos: ocupacion.ninos, ...(dto.ocupantes?.edadesNinos && { edadesNinos: dto.ocupantes.edadesNinos }) },
      plan: planCotizado,
      desglose: desglosePrecio,
      totalCentavos: desglose.total,
      moneda: 'USD',
      creadaEn: ahora,
      validaHasta,
    });

    return {
      alojamientoId: alojamiento.codigo,
      tipoHabitacionCodigo: habitacion.codigo,
      estaDisponible: true,
      habitacionesRemanentes: remanentes,
      nochesEstancia: noches.length,
      desglosePrecio,
      precioTotalCotizado: desglosePrecio.totalPagar,
      cotizacionId: cotizacion.id,
      tarifaValidaHasta: validaHasta.toISOString(),
      _links: { alojamiento: { href: `/api/v2/alojamientos/${alojamiento.codigo}`, method: 'GET' } },
      currency: 'USD',
      planTarifaCodigo: plan.codigo,
      modeloPago: plan.modeloPago,
      politicaCancelacion: plan.politicaCancelacion,
    };
  }

  // ───────────────────────── GET /alojamientos/{id}/availability ─────────────────────────
  async opciones(codigo: string, q: OpcionesDisponibilidadV2Query) {
    const noches = validarEstancia(q.checkin, q.checkout, { inicio: 'checkin', fin: 'checkout' });
    const alojamiento = await this.alojamientoActivo(codigo);
    const habitaciones = await this.catalogo.habitaciones({ alojamientoId: alojamiento.id, soloActivas: true, ...(q.tipoHabitacion && { codigo: q.tipoHabitacion }) });
    if (q.tipoHabitacion && habitaciones.length === 0) {
      throw noEncontrado(`El alojamiento '${codigo}' no tiene el tipo de habitación '${q.tipoHabitacion}'.`);
    }
    const ocupacion = this.ocupacion({ adultos: q.adults, ninos: q.children }, 'adults');
    // Solo los tipos donde caben los huéspedes
    const caben = habitaciones.filter((h) => this.cabe(h, ocupacion, q.rooms));
    const ids = caben.map((h) => h.id);
    const [planes, inventario, restricciones] = await Promise.all([this.planes(caben), this.noches(ids, noches), this.restricciones(ids, [...noches, q.checkout])]);
    const ahora = this.reloj.ahora();

    const opciones = caben.flatMap((h) => {
      const delaHabitacion = inventario.get(h.id) ?? [];
      if (delaHabitacion.length < noches.length) return []; // sin precio cargado en alguna noche: no se puede ofrecer
      const remanentes = Math.min(...delaHabitacion.map((n) => n.cupos));
      const libre = remanentes >= q.rooms && !evaluarRestricciones(noches, q.checkout, restricciones.get(h.id) ?? new Map(), ahora);
      return planes.get(h.id).map((plan) => {
        const d = calcularPrecio({
          noches: delaHabitacion.map(({ fecha, precioCentavos }) => ({ fecha, precioCentavos })),
          plan: plan.precio,
          habitaciones: q.rooms,
          adultos: ocupacion.adultos,
          edadesNinos: ocupacion.edadesNinos,
        });
        return {
          tipoHabitacionCodigo: h.codigo,
          nombre: `${h.nombre} · ${plan.nombre}`.slice(0, 100),
          estaDisponible: libre,
          habitacionesRemanentes: Math.max(0, remanentes),
          precioNoche: centavosAMoney(d.precioNocheCentavos),
          precioTotalEstancia: centavosAMoney(d.subtotal), // sin impuestos, como en el catálogo
          regimen: plan.regimen,
          planTarifaCodigo: plan.codigo,
        };
      });
    });

    return { alojamientoId: alojamiento.codigo, checkin: q.checkin, checkout: q.checkout, noches: noches.length, opciones: opciones.slice(0, 50) };
  }

  // ───────────────────────── Apoyo ─────────────────────────

  // La orden que fijó su precio con esta cotización la marca (en su transacción)
  // Fase 9.0: con su propia transacción de disponibilidad (quien llama ya no le pasa la suya; con un rol por módulo no podría escribir aquí)
  async marcarCotizacionUsada(id: string): Promise<void> {
    await this.dataSource.manager.update(Cotizacion, { id }, { usadaEn: () => 'COALESCE("usadaEn", now())' });
  }

  // Cotización por id (la usa la orden para fijar el precio); null si no existe
  async cotizacionPorId(id: string, manager?: EntityManager): Promise<DatosCotizacion | null> {
    return (manager ?? this.dataSource.manager).findOneBy(Cotizacion, { id });
  }

  async alojamientoActivo(codigo: string): Promise<{ id: number; codigo: string }> {
    const alojamiento = await this.catalogo.alojamientoPorCodigo(codigo, { soloActivo: true });
    if (!alojamiento) throw noEncontrado(`No existe el alojamiento '${codigo}'.`);
    return alojamiento;
  }

  // Niños: `ninos` o, si falta, la cantidad de edades. Si vienen los dos, tienen que coincidir.
  ocupacion(o: { adultos: number; ninos?: number; edadesNinos?: number[] }, campo: string): Ocupacion {
    return calcularOcupantes(o, campo);
  }

  // Los huéspedes se reparten lo más parejo posible entre las habitaciones pedidas
  private cabe(h: CapacidadHabitacion, o: Ocupacion, habitaciones: number): boolean {
    return cabeEnHabitacion(h, o, habitaciones);
  }

  exigirCapacidad(h: CapacidadHabitacion, o: Ocupacion, habitaciones: number): void {
    validarCapacidadHabitacion(h, o, habitaciones);
  }

  async planes(habitaciones: Pick<HabitacionCatalogo, 'id' | 'capacidadAdultos' | 'mealPlan' | 'cancellationType'>[]): Promise<Map<string, PlanV2[]>> {
    const ids = habitaciones.map((h) => h.id);
    const adicionales = ids.length ? await this.dataSource.getRepository(PlanTarifa).find({ where: { habitacionId: In(ids), activo: true } }) : [];
    return new Map(habitaciones.map((h) => [h.id, planesDeHabitacion(h, adicionales.filter((p) => p.habitacionId === h.id))]));
  }

  private async noches(habitacionIds: string[], noches: string[]): Promise<Map<string, Noche[]>> {
    const resultado = new Map<string, Noche[]>();
    if (habitacionIds.length === 0) return resultado;
    const filas: { habitacionId: string; fecha: string; cupos: number; precio: string }[] = await this.dataSource.query(
      `SELECT "habitacionId", to_char("fecha", 'YYYY-MM-DD') AS "fecha", "cupos", "precio" FROM "disponibilidad"."disponibilidad_diaria"
       WHERE "habitacionId" = ANY($1) AND "fecha" >= $2 AND "fecha" <= $3 ORDER BY "fecha"`,
      [habitacionIds, noches[0], noches[noches.length - 1]],
    );
    for (const f of filas) {
      const lista = resultado.get(f.habitacionId) ?? [];
      lista.push({ fecha: f.fecha, cupos: f.cupos, precioCentavos: aCentavos(Number(f.precio)) });
      resultado.set(f.habitacionId, lista);
    }
    return resultado;
  }

  async restricciones(habitacionIds: string[], fechas: string[]): Promise<Map<string, Map<string, RestriccionNoche>>> {
    const resultado = new Map<string, Map<string, RestriccionNoche>>();
    if (habitacionIds.length === 0) return resultado;
    const filas = await this.dataSource.getRepository(RestriccionDia).find({ where: { habitacionId: In(habitacionIds), fecha: In(fechas) } });
    for (const f of filas) {
      const mapa = resultado.get(f.habitacionId) ?? new Map<string, RestriccionNoche>();
      mapa.set(f.fecha, f);
      resultado.set(f.habitacionId, mapa);
    }
    return resultado;
  }

  // DesglosePrecioV2 del contrato
  aDesgloseV2(d: DesglosePrecio) {
    return construirDesgloseV2(d);
  }
}
