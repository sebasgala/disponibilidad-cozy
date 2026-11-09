import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { hoyIso, repartirHuespedes } from '../../comun/alojamientos-consulta.utils';
import { nodoCodigo } from '../../comun/codigos';
import { BuscarAlojamientosV2Dto, ListarAlojamientosV2Query } from './dto/catalogo-v2.dto';
import { aCentavos, centavosAMoney, centavosPorNoche, dinero, metadataPagina } from '../../comun/v2/dinero';
import { validarEstancia, exigirUsd } from '../../comun/v2/estancia';
import { CATEGORIAS, mealPlanDeRegimen, politicaDeCancelacion, regimenDeMealPlan } from '../../comun/v2/mapeos-v2';
import { noEncontrado } from '../../comun/v2/problemas-v2';
import { FuenteDisponibilidad } from '../fuente-disponibilidad';
import { PoliticaPaquetes } from '../politica-paquetes';
import { CONEXION } from '../../../database/conexiones';

const ZONA_HORARIA = 'America/Guayaquil';

interface FilaAlojamiento {
  id: number;
  codigo: string;
  nombre: string;
  destino: string;
  ciudadNombre: string | null;
  descripcion: string | null;
  moneda: string;
  precioPorNoche: string;
  estrellas: number;
  tipoPropiedad: string;
  direccion: string | null;
  latitud: string | null;
  longitud: string | null;
  checkInDesde: string;
  checkOutMaxima: string;
  fotos: string[] | null;
  facilidades: string[] | null;
  updatedAt: Date;
  minPrecio?: string | null;
  totalEstancia?: string;
}

interface FilaHabitacion {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  camas: string | null;
  metrosCuadrados: number | null;
  capacidadAdultos: number;
  capacidadNinos: number;
  precioBase: string;
  mealPlan: string | null;
  cancellationType: string | null;
  fotos: string[] | null;
  amenidades: string[] | null;
}

const SELECT_ALOJAMIENTO = `a."id", a."codigo", a."nombre", a."destino", a."descripcion", a."moneda", a."precioPorNoche", a."estrellas", a."tipoPropiedad",
  a."direccion", a."latitud", a."longitud", a."checkInDesde", a."checkOutMaxima", a."fotos", a."facilidades", a."updatedAt", c."nombre" AS "ciudadNombre"`;

// Los LIKE del usuario se toman literales: se escapan % y _
const comoLiteral = (texto: string) => texto.replace(/[\\%_]/g, '\\$&');

// Acumula parámetros posicionales ($1, $2...) de una consulta
function parametros() {
  const valores: unknown[] = [];
  return { valores, p: (valor: unknown) => (valores.push(valor), `$${valores.length}`) };
}

@Injectable()
export class CatalogoV2Service {
  constructor(@InjectDataSource(CONEXION.catalogo) private readonly dataSource: DataSource) {}

  // permitePaquete=true: solo los alojamientos cuya ciudad habilita el acuerdo B2B vigente (la regla de la compra)
  private async condicionPaquete(politica: PoliticaPaquetes | null, p: (valor: unknown) => string): Promise<string> {
    if (!politica) return 'false';
    if (politica.todosLosDestinos) return 'true';
    const ciudades: { id: number; nombre: string }[] = await this.dataSource.query(`SELECT "id", "nombre" FROM "catalogo"."ciudades"`);
    const ids = ciudades.filter((c) => politica.aceptaDestino(c.nombre)).map((c) => c.id);
    return ids.length ? `a."ciudadId" = ANY(${p(ids)}::int[])` : 'false';
  }

  // ───────────────────────── GET /alojamientos ─────────────────────────
  async listar(q: ListarAlojamientosV2Query, politica: PoliticaPaquetes | null) {
    const { valores, p } = parametros();
    const precio = `COALESCE(m."minPrecio", a."precioPorNoche")`;
    const condiciones = [`a."activo" = true`];
    if (q.ciudad) {
      const ph = p(q.ciudad);
      condiciones.push(`(LOWER(a."destino") = LOWER(${ph}) OR LOWER(c."nombre") = LOWER(${ph}))`);
    }
    if (q.estrellas !== undefined) condiciones.push(`a."estrellas" = ${p(q.estrellas)}`);
    if (q.minPrecio) condiciones.push(`${precio} >= ${p(q.minPrecio)}::numeric`);
    if (q.maxPrecio) condiciones.push(`${precio} <= ${p(q.maxPrecio)}::numeric`);
    if (q.permitePaquete === true) condiciones.push(await this.condicionPaquete(politica, p));
    if (q.actualizadoDesde) condiciones.push(`a."updatedAt" >= ${p(q.actualizadoDesde)}::timestamptz`);

    const desde = `FROM "catalogo"."alojamientos" a
      LEFT JOIN "catalogo"."ciudades" c ON c."id" = a."ciudadId"
      LEFT JOIN LATERAL (SELECT MIN(h."precioBase") AS "minPrecio" FROM "catalogo"."habitaciones" h WHERE h."alojamientoId" = a."id" AND h."activo" = true) m ON true
      WHERE ${condiciones.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${desde}`, valores);
    const filas: FilaAlojamiento[] = await this.dataSource.query(
      `SELECT ${SELECT_ALOJAMIENTO}, m."minPrecio" ${desde} ORDER BY a."id" LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      valores,
    );
    return {
      metadata: metadataPagina(total, q.page, q.limit),
      data: filas.map((f) => this.tarjeta(f, f.minPrecio ? aCentavos(Number(f.minPrecio)) : aCentavos(Number(f.precioPorNoche)), politica)),
    };
  }

  // ───────────────────────── POST /alojamientos/search ─────────────────────────
  // `fuente`: qué habitaciones tienen cupo todas las noches y a qué precio (lo sabe disponibilidad, no el catálogo)
  async buscar(dto: BuscarAlojamientosV2Dto, page: number, limit: number, fuente: FuenteDisponibilidad, politica: PoliticaPaquetes | null) {
    const noches = validarEstancia(dto.fechaInicio, dto.fechaFin).length;
    exigirUsd(dto.currency);

    const habitaciones = dto.habitaciones ?? 1;
    const ninos = dto.ninos ?? dto.edadesNinos?.length ?? 0;
    const reparto = repartirHuespedes({ number_of_adults: dto.adultos, number_of_rooms: habitaciones, children: Array.from({ length: ninos }, () => 0) });
    const meta = { destino: dto.destino, noches };
    const vacio = { request_id: randomUUID(), metadata: { ...metadataPagina(0, page, limit), ...meta }, data: [] };

    const { valores, p } = parametros();
    const ofertas = [`h."activo" = true`, `h."capacidadAdultos" >= ${p(reparto.adultosPorHabitacion)}`, `h."capacidadNinos" >= ${p(reparto.ninosPorHabitacion)}`];
    if (dto.regimen) {
      const mealPlan = mealPlanDeRegimen(dto.regimen);
      if (!mealPlan) return vacio; // Cozy no ofrece ese régimen
      ofertas.push(`h."mealPlan" = ${p(mealPlan)}`);
    }
    const disponibles = await fuente.ofertas({ checkin: dto.fechaInicio, checkout: dto.fechaFin, noches, cupos: habitaciones });
    const idsOferta = p([...disponibles.keys()]);
    const totalesOferta = p([...disponibles.values()]);

    const patron = p('%' + comoLiteral(dto.destino) + '%');
    const condiciones = [`a."activo" = true`, `(a."destino" ILIKE ${patron} OR c."nombre" ILIKE ${patron})`];
    if (dto.estrellasMinimas !== undefined) condiciones.push(`a."estrellas" >= ${p(dto.estrellasMinimas)}`);
    if (dto.precioMaximo) condiciones.push(`ROUND(mejor."total" / ${p(noches)}::numeric, 2) <= ${p(dto.precioMaximo)}::numeric`);
    if (dto.amenidadesDeseadas?.length) condiciones.push(`a."facilidades" @> ${p(JSON.stringify(dto.amenidadesDeseadas.map((x) => x.toLowerCase())))}::jsonb`);
    if (dto.permitePaquete === true) condiciones.push(await this.condicionPaquete(politica, p));

    // oferta = habitaciones libres TODAS las noches del rango, con cupos y capacidad suficientes, y su total por estancia
    const desde = `FROM "catalogo"."alojamientos" a
      JOIN (
        SELECT o."alojamientoId" AS aid, MIN(o."total") AS "total" FROM (
          SELECT h."alojamientoId", h."id", d."total"
          FROM "catalogo"."habitaciones" h
          JOIN unnest(${idsOferta}::uuid[], ${totalesOferta}::numeric[]) AS d("habitacionId", "total") ON d."habitacionId" = h."id"
          WHERE ${ofertas.join(' AND ')}
        ) o GROUP BY o."alojamientoId"
      ) mejor ON mejor.aid = a."id"
      LEFT JOIN "catalogo"."ciudades" c ON c."id" = a."ciudadId"
      WHERE ${condiciones.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(*)::int AS total ${desde}`, valores);
    const filas: FilaAlojamiento[] = await this.dataSource.query(
      `SELECT ${SELECT_ALOJAMIENTO}, mejor."total" AS "totalEstancia" ${desde} ORDER BY a."id" LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      valores,
    );
    return {
      request_id: randomUUID(),
      metadata: { ...metadataPagina(total, page, limit), ...meta },
      data: filas.map((f) => {
        const totalCentavos = aCentavos(Number(f.totalEstancia));
        return this.tarjeta(f, centavosPorNoche(totalCentavos, noches), politica, totalCentavos * habitaciones);
      }),
    };
  }

  // ───────────────────────── GET /alojamientos/categorias ─────────────────────────
  categorias() {
    return CATEGORIAS.map(({ id, nombre, slug, descripcion }, i) => ({ id, nombre, slug, descripcion, orden: i + 1 }));
  }

  // ───────────────────────── GET /alojamientos/{id} ─────────────────────────
  async ficha(codigo: string, politica: PoliticaPaquetes | null) {
    const fila = await this.buscarActivo(codigo);
    const [{ libre }] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM "catalogo"."habitaciones" WHERE "alojamientoId" = $1 AND "activo" = true AND "cancellationType" = 'free_cancellation') AS libre`,
      [fila.id],
    );
    const base = `/api/v2/alojamientos/${fila.codigo}`;
    const paquete = this.paquete(fila, politica);
    return {
      id: fila.codigo,
      nombre: fila.nombre,
      tipoPropiedad: fila.tipoPropiedad,
      ...(fila.descripcion && { descripcion: fila.descripcion }),
      destino: fila.destino,
      ...(fila.direccion && { direccion: fila.direccion }),
      ...(fila.latitud !== null && fila.longitud !== null && { coordenadasGps: { latitud: Number(fila.latitud), longitud: Number(fila.longitud) } }),
      zonaHoraria: ZONA_HORARIA,
      estrellas: fila.estrellas,
      politicaCancelacion: politicaDeCancelacion(libre ? 'free_cancellation' : null),
      checkInPermitidoDesde: fila.checkInDesde,
      checkOutHoraMaxima: fila.checkOutMaxima,
      amenidades: fila.facilidades ?? [],
      galeriaFotos: fila.fotos ?? [],
      ...paquete,
      proveedor: { id: `proveedor-${nodoCodigo().toLowerCase()}`, nombre: 'Cozy' },
      actualizadoEn: fila.updatedAt.toISOString(),
      _links: { self: { href: base, method: 'GET' }, habitaciones: { href: `${base}/habitaciones`, method: 'GET' } },
    };
  }

  // ───────────────────────── GET /alojamientos/{id}/habitaciones ─────────────────────────
  // `fuente`: cupos de la próxima noche y planes de tarifa de cada habitación (los sabe disponibilidad)
  async habitaciones(codigo: string, fuente: FuenteDisponibilidad) {
    const fila = await this.buscarActivo(codigo);
    const filas: FilaHabitacion[] = await this.dataSource.query(
      `SELECT h."id", h."codigo", h."nombre", h."descripcion", h."camas", h."metrosCuadrados", h."capacidadAdultos", h."capacidadNinos",
              h."precioBase", h."mealPlan", h."cancellationType", h."fotos", h."amenidades"
       FROM "catalogo"."habitaciones" h
       WHERE h."alojamientoId" = $1 AND h."activo" = true
       ORDER BY h."nombre"`,
      [fila.id],
    );
    const [proxima, planes] = await Promise.all([
      fuente.proximaNoche(filas.map((h) => h.id), hoyIso()),
      fuente.planesV2(filas.map((h) => ({ id: h.id, capacidadAdultos: h.capacidadAdultos, mealPlan: h.mealPlan, cancellationType: h.cancellationType, precioBase: Number(h.precioBase) }))),
    ]);
    return {
      alojamientoId: fila.codigo,
      alojamientoNombre: fila.nombre,
      habitaciones: filas.map((h) => {
        const regimen = regimenDeMealPlan(h.mealPlan);
        const precioBaseNoche = dinero(Number(h.precioBase));
        return {
          codigo: h.codigo,
          nombre: h.nombre,
          ...(h.descripcion && { descripcion: h.descripcion }),
          capacidadAdultos: h.capacidadAdultos,
          capacidadNinos: h.capacidadNinos,
          ...(h.camas && { camas: h.camas }),
          ...(h.metrosCuadrados && { metrosCuadrados: h.metrosCuadrados }),
          ...(regimen && { regimen }),
          precioBaseNoche,
          habitacionesTotales: proxima.get(h.id)?.cuposTotales ?? 0,
          habitacionesDisponibles: proxima.get(h.id)?.cupos ?? 0,
          ...(h.amenidades?.length && { amenidadesHabitacion: h.amenidades }),
          ...(h.fotos?.length && { fotos: h.fotos }),
          // ESTANDAR (derivado de la habitación) y los planes adicionales activos
          planesTarifa: planes.get(h.id) ?? [],
        };
      }),
    };
  }

  // ───────────────────────── Apoyo ─────────────────────────
  private async buscarActivo(codigo: string): Promise<FilaAlojamiento> {
    const [fila] = await this.dataSource.query(
      `SELECT ${SELECT_ALOJAMIENTO} FROM "catalogo"."alojamientos" a LEFT JOIN "catalogo"."ciudades" c ON c."id" = a."ciudadId" WHERE a."codigo" = $1 AND a."activo" = true`,
      [codigo],
    );
    if (!fila) throw noEncontrado(`No existe el alojamiento '${codigo}'.`);
    return fila;
  }

  // permitePaquete y descuentoMaximo del alojamiento según el acuerdo B2B (el máximo solo se publica si acepta paquetes)
  private paquete(f: FilaAlojamiento, politica: PoliticaPaquetes | null) {
    if (!politica || !politica.aceptaDestino(f.ciudadNombre)) return { permitePaquete: false };
    return { permitePaquete: true, descuentoMaximo: politica.descuentoMaximo };
  }

  // AlojamientoCardV2. Los importes llegan en centavos enteros y salen como Money.
  private tarjeta(f: FilaAlojamiento, precioNocheCentavos: number, politica: PoliticaPaquetes | null, totalEstanciaCentavos?: number) {
    return {
      id: f.codigo,
      nombre: f.nombre,
      tipoPropiedad: f.tipoPropiedad,
      destino: f.destino,
      ...(f.direccion && { direccion: f.direccion }),
      estrellas: f.estrellas,
      precioPorNoche: centavosAMoney(precioNocheCentavos),
      ...(totalEstanciaCentavos !== undefined && { precioTotalEstancia: centavosAMoney(totalEstanciaCentavos) }),
      moneda: f.moneda,
      ...this.paquete(f, politica),
      checkInPermitidoDesde: f.checkInDesde,
      checkOutHoraMaxima: f.checkOutMaxima,
      ...(f.fotos?.length && { fotos: f.fotos }),
      ...(f.facilidades?.length && { amenidades: f.facilidades }),
      actualizadoEn: f.updatedAt.toISOString(),
    };
  }
}
