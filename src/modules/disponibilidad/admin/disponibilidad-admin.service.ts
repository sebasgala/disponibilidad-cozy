import { InjectDataSource } from '@nestjs/typeorm';

import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DisponibilidadDiaria } from '../entities/disponibilidad-diaria.entity';
import { UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { DisponibilidadService } from '../disponibilidad.service';
import { StockOutboxService } from '../v2/stock-outbox.service';
import { AuditoriaService } from '../../comun/auditoria.service';
import {
  CambioDisponibilidadDto,
  DiaDisponibilidadDto,
  DisponibilidadAdminResponseDto,
  EdicionDisponibilidadResponseDto,
  EditarRangoDto,
} from '../dto/admin/disponibilidad-admin.dto';
import { ConflictoException, ConsultaInvalidaException, InvalidParam } from '../../comun/problems/problem-details.exceptions';
import { CatalogoPuerto, RefHabitacionStock } from '../../catalogo/catalogo.puerto';
import { exigirFechaNoPasada } from '../../comun/alojamientos-consulta.utils';
import { CONEXION } from '../../../database/conexiones';

const DIAS_MAXIMOS = 366;
const UN_DIA = 24 * 60 * 60 * 1000;
// Primera clave del candado consultivo (pg_advisory_xact_lock) de "edición de disponibilidad por el admin".
const CANDADO_DISPONIBILIDAD = 7001;

// Días [desde, hasta] (ambos incluidos) como 'YYYY-MM-DD', con su día de la semana (0 = domingo).
export function diasDelRango(desde: string, hasta: string): { fecha: string; diaSemana: number }[] {
  const inicio = Date.parse(`${desde}T00:00:00Z`);
  const cantidad = Math.round((Date.parse(`${hasta}T00:00:00Z`) - inicio) / UN_DIA) + 1;
  return Array.from({ length: cantidad }, (_, i) => {
    const d = new Date(inicio + i * UN_DIA);
    return { fecha: d.toISOString().slice(0, 10), diaSemana: d.getUTCDay() };
  });
}

export function validarRango(desde: string, hasta: string): void {
  if (hasta < desde) throw new ConsultaInvalidaException([{ name: 'hasta', reason: 'debe ser igual o posterior a desde' }]);
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / UN_DIA) + 1;
  if (dias > DIAS_MAXIMOS) {
    throw new ConsultaInvalidaException([{ name: 'hasta', reason: `el rango no puede pasar de ${DIAS_MAXIMOS} días (pediste ${dias})` }]);
  }
}

const aDia = (fila: { fecha: string; cuposTotales: number; cupos: number; precio: number }): DiaDisponibilidadDto => ({
  fecha: fila.fecha,
  cuposTotales: fila.cuposTotales,
  cupos: fila.cupos,
  vendidas: fila.cuposTotales - fila.cupos,
  precio: Number(fila.precio),
});

// Disponibilidad y precios por fecha de una habitación, para el admin.
//
// Regla anti-sobreventa: el admin edita cuposTotales (lo que EXISTE), nunca cupos (lo que QUEDA).
// Al cambiar el total, lo que queda se mueve lo mismo: cupos += nuevoTotal - totalAnterior. Así nunca se
// pisan las reservas: las vendidas (cuposTotales - cupos) no cambian. Si el nuevo total quedara por debajo
// de lo vendido, cupos sería negativo y la operación entera se rechaza con 409, indicando las fechas.
@Injectable()
export class DisponibilidadAdminService {
  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly disponibilidadService: DisponibilidadService,
    private readonly catalogo: CatalogoPuerto,
    private readonly auditoria: AuditoriaService,
    private readonly stock: StockOutboxService,
  ) {}

  async listar(habitacionId: string, desde: string, hasta: string, usuario: Usuario): Promise<DisponibilidadAdminResponseDto> {
    const habitacion = await this.catalogo.habitacionAdministrable(habitacionId, usuario);
    validarRango(desde, hasta);
    const filas = await this.dataSource
      .getRepository(DisponibilidadDiaria)
      .createQueryBuilder('d')
      .where('d.habitacionId = :id', { id: habitacion.id })
      .andWhere('d.fecha >= :desde AND d.fecha <= :hasta', { desde, hasta })
      .orderBy('d.fecha', 'ASC')
      .getMany();
    return { habitacionId: habitacion.id, desde, hasta, dias: filas.map(aDia) };
  }

  // Edita un rango (o un solo día, con desde = hasta) en UNA transacción: todo o nada.
  async editar(habitacionId: string, dto: EditarRangoDto, usuario: Usuario): Promise<EdicionDisponibilidadResponseDto> {
    const habitacion = await this.catalogo.habitacionAdministrable(habitacionId, usuario);
    validarRango(dto.desde, dto.hasta);
    // El pasado no se edita: ya no se puede vender y cambiarlo solo desordenaría el historial.
    exigirFechaNoPasada(dto.desde, 'desde', 'desde');
    if (dto.cuposTotales === undefined && dto.precio === undefined) {
      throw new ConsultaInvalidaException([
        { name: 'cuposTotales', reason: 'envía cuposTotales, precio o ambos' },
        { name: 'precio', reason: 'envía cuposTotales, precio o ambos' },
      ]);
    }
    const fechas = diasDelRango(dto.desde, dto.hasta)
      .filter((d) => !dto.diasSemana || dto.diasSemana.includes(d.diaSemana))
      .map((d) => d.fecha);
    if (fechas.length === 0) {
      throw new ConsultaInvalidaException([{ name: 'diasSemana', reason: 'ningún día del rango cae en esos días de la semana' }]);
    }

    return this.dataSource.transaction((manager) => this.editarEnTransaccion(manager, habitacion, fechas, dto, usuario));
  }

  private async editarEnTransaccion(
    manager: EntityManager,
    habitacion: RefHabitacionStock, // del catálogo, leída antes de abrir esta transacción (fase 8.2)
    fechas: string[],
    dto: EditarRangoDto,
    usuario: Usuario,
  ): Promise<EdicionDisponibilidadResponseDto> {
    const habitacionId = habitacion.id;
    // 1. Dos ediciones del admin sobre la misma habitación pasan de a una. Cubre también los días que todavía
    //    no tienen fila (no se pueden bloquear con FOR UPDATE porque no existen).
    await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CANDADO_DISPONIBILIDAD, habitacionId]);

    // 2. Bloqueo de las noches existentes en orden de fecha, igual que el create de órdenes: una orden que se
    //    está creando sobre estas noches termina antes o espera a que termine la edición.
    const despuesDeHasta = new Date(Date.parse(`${fechas[fechas.length - 1]}T00:00:00Z`) + UN_DIA).toISOString().slice(0, 10);
    const bloqueadas = await this.disponibilidadService.bloquearNoches(manager, habitacionId, fechas[0], despuesDeHasta);
    const existentes = new Map(bloqueadas.map((fila) => [fila.fecha, fila]));

    // 3. Calcular el resultado de cada día sin escribir nada todavía.
    const cambios: CambioDisponibilidadDto[] = [];
    const conflictos: InvalidParam[] = [];
    const faltan: string[] = [];
    for (const fecha of fechas) {
      const fila = existentes.get(fecha);
      if (!fila) {
        if (dto.cuposTotales === undefined || dto.precio === undefined) {
          faltan.push(fecha);
          continue;
        }
        cambios.push({
          fecha,
          accion: 'crear',
          antes: null,
          despues: aDia({ fecha, cuposTotales: dto.cuposTotales, cupos: dto.cuposTotales, precio: dto.precio }),
        });
        continue;
      }
      const antes = aDia(fila);
      const cuposTotales = dto.cuposTotales ?? fila.cuposTotales;
      const cupos = fila.cupos + (cuposTotales - fila.cuposTotales);
      if (cupos < 0) {
        conflictos.push({
          name: `cuposTotales[${fecha}]`,
          reason: `${fecha}: hay ${antes.vendidas} habitaciones vendidas; cuposTotales no puede ser menor que ${antes.vendidas}`,
        });
        continue;
      }
      const despues = aDia({ fecha, cuposTotales, cupos, precio: dto.precio ?? fila.precio });
      const igual = despues.cuposTotales === antes.cuposTotales && despues.precio === antes.precio;
      cambios.push({ fecha, accion: igual ? 'sin_cambios' : 'actualizar', antes, despues });
    }

    if (faltan.length > 0) {
      throw new ConsultaInvalidaException([
        { name: 'cuposTotales', reason: `para crear días nuevos hacen falta cuposTotales y precio: ${faltan.join(', ')}` },
      ]);
    }
    if (conflictos.length > 0) {
      const fechasConflicto = conflictos.map((c) => c.name.slice('cuposTotales['.length, -1));
      throw new ConflictoException(
        'VALIDATION_FAILED',
        `No se puede bajar cuposTotales por debajo de lo ya vendido en: ${fechasConflicto.join(', ')}. No se guardó ningún cambio`,
        conflictos,
      );
    }

    // 4. Escribir (salvo vista previa). El SQL usa el valor relativo, así lo vendido nunca cambia.
    if (!dto.dryRun) {
      for (const cambio of cambios) {
        if (cambio.accion === 'actualizar') {
          await manager
            .createQueryBuilder()
            .update(DisponibilidadDiaria)
            .set({
              cupos: () => `"cupos" + (:nuevoTotal - "cuposTotales")`,
              cuposTotales: cambio.despues.cuposTotales,
              precio: cambio.despues.precio,
            })
            .setParameter('nuevoTotal', cambio.despues.cuposTotales)
            .where('habitacionId = :habitacionId AND fecha = :fecha', { habitacionId, fecha: cambio.fecha })
            .execute();
        }
      }
      const nuevas = cambios.filter((c) => c.accion === 'crear');
      if (nuevas.length > 0) {
        await manager.insert(
          DisponibilidadDiaria,
          nuevas.map((c) => ({
            habitacionId,
            fecha: c.fecha,
            cuposTotales: c.despues.cuposTotales,
            cupos: c.despues.cupos,
            precio: c.despues.precio,
          })),
        );
      }
    }

    // 5. Auditoría en la misma transacción (la vista previa no cambia nada, así que no deja fila).
    const modificados = cambios.filter((c) => c.accion !== 'sin_cambios');
    if (!dto.dryRun && modificados.length > 0) {
      await this.auditoria.registrar(manager, {
        modulo: 'disponibilidad',
        usuarioId: usuario.id,
        accion: 'editar_disponibilidad',
        entidad: 'disponibilidad',
        entidadId: habitacionId,
        antes: Object.fromEntries(modificados.map((c) => [c.fecha, c.antes])),
        despues: Object.fromEntries(modificados.map((c) => [c.fecha, c.despues])),
      });
      // Booking solo necesita enterarse de las noches cuyo stock cambió (un cambio de precio no lo cambia).
      // Va al final: el aviso y sus eventos se confirman o se deshacen con esta misma transacción.
      await this.stock.encolar(manager, habitacion, modificados.filter((c) => c.antes?.cupos !== c.despues.cupos).map((c) => c.fecha), 'INVENTARIO');
    }

    return {
      habitacionId,
      dryRun: Boolean(dto.dryRun),
      resumen: {
        creados: cambios.filter((c) => c.accion === 'crear').length,
        actualizados: cambios.filter((c) => c.accion === 'actualizar').length,
        sinCambios: cambios.filter((c) => c.accion === 'sin_cambios').length,
      },
      cambios,
    };
  }
}
