import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { CatalogoPuerto } from '../../catalogo/catalogo.puerto';
import { RestriccionDia } from '../entities/restriccion-dia.entity';
import { PrincipalV2 } from '../../usuarios/v2/autenticacion-v2';
import { aCentavos, centavosAMoney } from '../../comun/v2/dinero';
import { DisponibilidadV2Service } from './disponibilidad-v2.service';
import { esFechaValida } from '../../comun/alojamientos-consulta.utils';
import { planesDeHabitacion } from './planes';
import { aplicarAjuste } from '../../comun/v2/precios';
import { noEncontrado, peticionInvalida, ProblemaV2Exception, reglaDeNegocio } from '../../comun/v2/problemas-v2';
import { hashInventario } from './stock-envio';
import { CONEXION } from '../../../database/conexiones';

// GET /alojamientos/{id}/inventario (contrato v2 §5): la fuente de verdad que Booking consulta para conciliar cuando
// el stock que tiene no coincide con el nuestro. Por noche y tipo de habitación:
//   habitacionesTotales = cuposTotales        reservadas = totales − cupos        (lo vendido, v1 y v2)
//   bloqueadas / disponibles                  si el tipo está activo: 0 / cupos; si está dado de baja (él o el
//                                             alojamiento): cupos / 0 (no se vende)
//   tarifas                                   el precio de cada plan activo esa noche y sus restricciones
const MAX_NOCHES = 92;
const MAX_ITEMS = 3000;
const UN_DIA = 86_400_000;

@Injectable()
export class InventarioV2Service {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly disponibilidad: DisponibilidadV2Service,
    private readonly catalogo: CatalogoPuerto,
  ) {}

  async snapshot(codigo: string, desde: string, hasta: string, tipoHabitacion: string | undefined, principal: PrincipalV2) {
    if (!esFechaValida(desde)) throw peticionInvalida([{ name: 'desde', reason: 'debe ser una fecha válida YYYY-MM-DD' }]);
    if (!esFechaValida(hasta)) throw peticionInvalida([{ name: 'hasta', reason: 'debe ser una fecha válida YYYY-MM-DD' }]);
    if (hasta < desde) throw reglaDeNegocio('VALIDATION_FAILED', 'hasta debe ser igual o posterior a desde.', [{ name: 'hasta', reason: 'debe ser igual o posterior a desde' }]);
    const noches = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / UN_DIA) + 1;
    if (noches > MAX_NOCHES) {
      throw reglaDeNegocio('VALIDATION_FAILED', `El rango máximo es de ${MAX_NOCHES} noches (se pidieron ${noches}).`, [{ name: 'hasta', reason: `el rango no puede superar ${MAX_NOCHES} noches` }]);
    }

    // También los alojamientos dados de baja: Booking tiene que ver que ya no se venden
    const alojamiento = await this.catalogo.alojamientoPorCodigo(codigo);
    if (!alojamiento) throw noEncontrado(`No existe el alojamiento '${codigo}'.`);
    if (principal.rol === 'ADMIN' && !principal.superadmin && alojamiento.propietarioId !== principal.usuarioId) {
      throw new ProblemaV2Exception(403, 'FORBIDDEN', 'El alojamiento no es de los que administras.');
    }

    const habitaciones = await this.catalogo.habitaciones({ alojamientoId: alojamiento.id, ...(tipoHabitacion && { codigo: tipoHabitacion }) });
    if (tipoHabitacion && habitaciones.length === 0) throw noEncontrado(`El alojamiento '${codigo}' no tiene el tipo de habitación '${tipoHabitacion}'.`);

    const ids = habitaciones.map((h) => h.id);
    const filas: { habitacionId: string; fecha: string; cupos: number; cuposTotales: number; precio: string }[] = ids.length
      ? await this.dataSource.query(
          `SELECT "habitacionId", "fecha"::text AS "fecha", "cupos", "cuposTotales", "precio" FROM "disponibilidad"."disponibilidad_diaria"
           WHERE "habitacionId" = ANY($1::uuid[]) AND "fecha" >= $2 AND "fecha" <= $3 ORDER BY "fecha", "habitacionId"`,
          [ids, desde, hasta],
        )
      : [];
    if (filas.length > MAX_ITEMS) {
      throw reglaDeNegocio('VALIDATION_FAILED', `El rango tiene ${filas.length} noches por tipo de habitación y el máximo es ${MAX_ITEMS}. Acota el rango o el tipo.`, [
        { name: 'hasta', reason: 'el rango es demasiado grande' },
      ]);
    }

    const porId = new Map(habitaciones.map((h) => [h.id, h]));
    const planes = await this.disponibilidad.planes(habitaciones.filter((h) => h.activo));
    const restricciones = ids.length ? await this.dataSource.getRepository(RestriccionDia).find({ where: { habitacionId: In(ids) } }) : [];
    const restriccionDe = new Map(restricciones.map((r) => [`${r.habitacionId}|${r.fecha}`, r]));

    const listado = filas
      .map((f) => {
        const h = porId.get(f.habitacionId);
        const activa = h.activo && alojamiento.activo;
        const reservadas = Math.max(0, f.cuposTotales - f.cupos);
        const tarifas = activa
          ? (planes.get(h.id) ?? []).map((plan) => {
              const r = restriccionDe.get(`${h.id}|${f.fecha}`);
              return {
                planTarifaCodigo: plan.codigo,
                precioNoche: centavosAMoney(aplicarAjuste(aCentavos(Number(f.precio)), plan.precio.ajusteCentesimas)),
                ...(r && {
                  restricciones: {
                    fecha: f.fecha,
                    ...(r.estanciaMinima && { estanciaMinima: r.estanciaMinima }),
                    ...(r.estanciaMaxima && { estanciaMaxima: r.estanciaMaxima }),
                    cerradoALlegada: r.cerradoALlegada,
                    cerradoASalida: r.cerradoASalida,
                    ventaCerrada: r.ventaCerrada,
                    ...(r.anticipacionMinimaHoras !== null && { anticipacionMinimaHoras: r.anticipacionMinimaHoras }),
                  },
                }),
              };
            })
          : [];
        return {
          fecha: f.fecha,
          tipoHabitacionCodigo: h.codigo,
          habitacionesTotales: f.cuposTotales,
          reservadas,
          bloqueadas: activa ? 0 : Math.max(0, f.cupos),
          disponibles: activa ? Math.max(0, f.cupos) : 0,
          ...(tarifas.length > 0 && { tarifas }),
        };
      })
      .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.tipoHabitacionCodigo < b.tipoHabitacionCodigo ? -1 : 1));

    return {
      alojamientoId: alojamiento.codigo,
      desde,
      hasta,
      generadoEn: new Date().toISOString(),
      hash: hashInventario(listado),
      noches: listado,
    };
  }
}
