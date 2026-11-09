import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UsuarioSesion } from '../usuarios/usuarios.contrato';
import { AccesoAdminService } from './admin/acceso-admin.service';
import { CONEXION } from '../../database/conexiones';

// Puerto de lectura del catálogo (fase 8.0): lo único que los otros dominios pueden saber de ciudades, alojamientos y
// habitaciones. Devuelve objetos planos, nunca entidades: quien lo usa no puede guardarlos ni seguir relaciones.
// Cuando el catálogo sea un servicio aparte, estos métodos serán llamadas a su API.
// Fase 8.2: ningún método recibe la transacción de quien llama. Se lee siempre por la conexión propia y ANTES de que
// el otro dominio abra su transacción: el catálogo nunca se lee dentro de la transacción de otro.

export interface AlojamientoCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
  propietarioId: string | null;
  checkInDesde: string;
  moneda: string;
  ciudadNombre: string | null;
}

export interface HabitacionCatalogo {
  id: string;
  alojamientoId: number;
  codigo: string;
  nombre: string;
  tipo: string;
  activo: boolean;
  capacidadAdultos: number;
  capacidadNinos: number;
  precioBase: number;
  mealPlan: string | null;
  cancellationType: string | null;
  alojamientoCodigo: string;
  alojamientoActivo: boolean;
  alojamientoCheckInDesde: string;
}

export interface FiltroHabitaciones {
  alojamientoId?: number;
  ids?: string[];
  codigo?: string;
  soloActivas?: boolean;
}

const SELECT_ALOJAMIENTO = `a."id", a."codigo", a."nombre", a."activo", a."propietarioId", a."checkInDesde", a."moneda", c."nombre" AS "ciudadNombre"
  FROM "catalogo"."alojamientos" a LEFT JOIN "catalogo"."ciudades" c ON c."id" = a."ciudadId"`;

const SELECT_HABITACION = `h."id", h."alojamientoId", h."codigo", h."nombre", h."tipo", h."activo", h."capacidadAdultos", h."capacidadNinos",
  h."precioBase", h."mealPlan", h."cancellationType", a."codigo" AS "alojamientoCodigo", a."activo" AS "alojamientoActivo",
  a."checkInDesde" AS "alojamientoCheckInDesde"
  FROM "catalogo"."habitaciones" h JOIN "catalogo"."alojamientos" a ON a."id" = h."alojamientoId"`;

// Lo que disponibilidad necesita de una habitación para avisar su stock (códigos y si se vende)
export type RefHabitacionStock = Pick<HabitacionCatalogo, 'id' | 'alojamientoId' | 'codigo' | 'activo' | 'alojamientoCodigo' | 'alojamientoActivo'>;

const aHabitacion = (f: HabitacionCatalogo): HabitacionCatalogo => ({ ...f, alojamientoId: Number(f.alojamientoId), precioBase: Number(f.precioBase) });

@Injectable()
export class CatalogoPuerto {
  constructor(
    @InjectDataSource(CONEXION.catalogo) private readonly dataSource: DataSource,
    private readonly acceso: AccesoAdminService,
  ) {}

  async alojamientoPorCodigo(codigo: string, opciones: { soloActivo?: boolean } = {}): Promise<AlojamientoCatalogo | null> {
    const [fila] = await this.dataSource.query(`SELECT ${SELECT_ALOJAMIENTO} WHERE a."codigo" = $1${opciones.soloActivo ? ' AND a."activo" = true' : ''}`, [codigo]);
    return fila ?? null;
  }

  async alojamientoPorId(id: number): Promise<AlojamientoCatalogo | null> {
    const [fila] = await this.dataSource.query(`SELECT ${SELECT_ALOJAMIENTO} WHERE a."id" = $1`, [id]);
    return fila ?? null;
  }

  // Un id fuera del rango de integer haría fallar a PostgreSQL: no puede existir
  async alojamientoActivoPorId(id: number): Promise<AlojamientoCatalogo | null> {
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) return null;
    const a = await this.alojamientoPorId(id);
    return a?.activo ? a : null;
  }

  async alojamientosPorIds(ids: number[]): Promise<Map<number, AlojamientoCatalogo>> {
    if (ids.length === 0) return new Map();
    const filas: AlojamientoCatalogo[] = await this.dataSource.query(`SELECT ${SELECT_ALOJAMIENTO} WHERE a."id" = ANY($1::int[])`, [[...new Set(ids)]]);
    return new Map(filas.map((f) => [f.id, f]));
  }

  // Ids de los alojamientos de un administrador (autorización por propietario en los otros dominios)
  async idsDeAlojamientosDe(propietarioId: string): Promise<number[]> {
    const filas: { id: number }[] = await this.dataSource.query(`SELECT "id" FROM "catalogo"."alojamientos" WHERE "propietarioId" = $1`, [propietarioId]);
    return filas.map((f) => f.id);
  }

  // Lo que está a la venta: alojamientos activos y sus habitaciones activas (telemetría de /health)
  async aLaVenta(): Promise<{ propiedades: number; habitacionIds: string[] }> {
    const [{ propiedades }] = await this.dataSource.query(`SELECT COUNT(*)::int AS propiedades FROM "catalogo"."alojamientos" WHERE "activo" = true`);
    const filas: { id: string }[] = await this.dataSource.query(
      `SELECT h."id" FROM "catalogo"."habitaciones" h JOIN "catalogo"."alojamientos" a ON a."id" = h."alojamientoId" WHERE h."activo" = true AND a."activo" = true`,
    );
    return { propiedades, habitacionIds: filas.map((f) => f.id) };
  }

  // Habitaciones por alojamiento, ids o código; ordenadas por nombre
  async habitaciones(filtro: FiltroHabitaciones): Promise<HabitacionCatalogo[]> {
    const condiciones: string[] = [];
    const valores: unknown[] = [];
    const p = (v: unknown) => (valores.push(v), `$${valores.length}`);
    if (filtro.alojamientoId !== undefined) condiciones.push(`h."alojamientoId" = ${p(filtro.alojamientoId)}`);
    if (filtro.ids) {
      if (filtro.ids.length === 0) return [];
      condiciones.push(`h."id" = ANY(${p([...new Set(filtro.ids)])}::uuid[])`);
    }
    if (filtro.codigo !== undefined) condiciones.push(`h."codigo" = ${p(filtro.codigo)}`);
    if (filtro.soloActivas) condiciones.push(`h."activo" = true`);
    const filas: HabitacionCatalogo[] = await this.dataSource.query(
      `SELECT ${SELECT_HABITACION}${condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : ''} ORDER BY h."nombre", h."id"`,
      valores,
    );
    return filas.map(aHabitacion);
  }

  async habitacionesPorIds(ids: string[]): Promise<Map<string, HabitacionCatalogo>> {
    return new Map((await this.habitaciones({ ids })).map((h) => [h.id, h]));
  }

  async habitacionActiva(alojamientoId: number, codigo: string): Promise<HabitacionCatalogo | null> {
    const [h] = await this.habitaciones({ alojamientoId, codigo, soloActivas: true });
    return h ?? null;
  }

  // Habitación que el usuario del panel puede administrar (activa o no). Fuera de su alcance o inexistente: 404, con
  // la misma regla que AccesoAdminService. Para disponibilidad (inventario, planes y restricciones), en objeto plano.
  async habitacionAdministrable(id: string, usuario: UsuarioSesion): Promise<HabitacionCatalogo> {
    const h = await this.acceso.habitacion(id, usuario);
    return aHabitacion({
      id: h.id,
      alojamientoId: h.alojamientoId,
      codigo: h.codigo,
      nombre: h.nombre,
      tipo: h.tipo,
      activo: h.activo,
      capacidadAdultos: h.capacidadAdultos,
      capacidadNinos: h.capacidadNinos,
      precioBase: h.precioBase,
      mealPlan: h.mealPlan ?? null,
      cancellationType: h.cancellationType ?? null,
      alojamientoCodigo: h.alojamiento.codigo,
      alojamientoActivo: h.alojamiento.activo,
      alojamientoCheckInDesde: h.alojamiento.checkInDesde,
    });
  }
}
