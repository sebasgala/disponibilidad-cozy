import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  ActualizarHabitacionDto,
  CrearHabitacionDto,
  FiltroHabitacionesQueryDto,
  HabitacionAdminResponseDto,
} from '../dto/admin/habitacion-admin.dto';
import { RolUsuario, UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { JwtAuthGuard } from '../../usuarios/seguridad/jwt-auth.guard';
import { Roles, UsuarioActual } from '../../usuarios/seguridad/roles.decorator';
import { RolesGuard } from '../../usuarios/seguridad/roles.guard';
import { ProblemDetailsFilter } from '../../comun/problems/problem-details.filter';
import { respuestaProblema } from '../../comun/problems/respuestas-swagger';
import { idEntero, idUuid, validacionAdmin } from '../../comun/problems/validacion.pipes';
import { HabitacionesAdminService } from './habitaciones-admin.service';

// ─────────────────────────────────────────────────────────────────────────────
// Administración de habitaciones (/api/v1/admin/...). NO es parte del contrato.
//
// Exige login y rol administrador o superadmin. Que el alojamiento pertenezca al administrador lo decide
// AccesoAdminService (fuera de su alcance => 404).
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Interno - Admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMINISTRADOR, RolUsuario.SUPERADMIN)
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin')
export class HabitacionesAdminController {
  constructor(private readonly habitacionesAdminService: HabitacionesAdminService) {}

  @Get('alojamientos/:alojamientoId/habitaciones')
  @ApiOperation({ summary: 'Listar las habitaciones de un alojamiento', description: 'Por defecto solo las activas; incluirInactivas=true trae todas.' })
  @ApiParam({ name: 'alojamientoId', type: 'integer', example: 1 })
  @ApiResponse({ status: 200, description: 'Habitaciones del alojamiento', type: [HabitacionAdminResponseDto] })
  @ApiResponse(respuestaProblema(400, 'Parámetros inválidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  listar(
    @Param('alojamientoId', idEntero('alojamientoId')) alojamientoId: number,
    @Query() filtro: FiltroHabitacionesQueryDto,
    @UsuarioActual() usuario: Usuario,
  ) {
    return this.habitacionesAdminService.listar(alojamientoId, filtro, usuario);
  }

  @Post('alojamientos/:alojamientoId/habitaciones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una habitación', description: 'Nace activa y sin disponibilidad: los cupos y precios por fecha se cargan aparte.' })
  @ApiParam({ name: 'alojamientoId', type: 'integer', example: 1 })
  @ApiResponse({ status: 201, description: 'Habitación creada. Devuelve la cabecera Location.', type: HabitacionAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos o campos no permitidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  async crear(
    @Param('alojamientoId', idEntero('alojamientoId')) alojamientoId: number,
    @Body() dto: CrearHabitacionDto,
    @UsuarioActual() usuario: Usuario,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nueva = await this.habitacionesAdminService.crear(alojamientoId, dto, usuario);
    res.setHeader('Location', nueva._links.self);
    return nueva;
  }

  @Get('habitaciones/:id')
  @ApiOperation({ summary: 'Ver una habitación (también si está desactivada)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Detalle de la habitación', type: HabitacionAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'El id no es un UUID'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  obtener(@Param('id', idUuid('id')) id: string, @UsuarioActual() usuario: Usuario) {
    return this.habitacionesAdminService.obtener(id, usuario);
  }

  @Patch('habitaciones/:id')
  @ApiOperation({ summary: 'Actualizar parcialmente una habitación', description: 'nombre, tipo, capacidades, precioBase, mealPlan y cancellationType.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Habitación actualizada', type: HabitacionAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, null en un campo obligatorio o campos no permitidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  actualizar(@Param('id', idUuid('id')) id: string, @Body() dto: ActualizarHabitacionDto, @UsuarioActual() usuario: Usuario) {
    return this.habitacionesAdminService.actualizar(id, dto, usuario);
  }

  @Post('habitaciones/:id/desactivar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactivar una habitación (borrado lógico)',
    description:
      'Deja de venderse en /search, /availability, /details y preview. No borra órdenes ni disponibilidad. Repetirlo no da error. ' +
      'Si tiene reservas CONFIRMED con salida posterior a hoy, responde 409 con sus localizadores: hay que cancelarlas antes.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Habitación desactivada', type: HabitacionAdminResponseDto })
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  @ApiResponse(respuestaProblema(409, 'Tiene reservas confirmadas vigentes; no se desactiva'))
  desactivar(@Param('id', idUuid('id')) id: string, @UsuarioActual() usuario: Usuario) {
    return this.habitacionesAdminService.cambiarEstado(id, false, usuario);
  }

  @Post('habitaciones/:id/reactivar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivar una habitación', description: 'Vuelve a venderse. Repetirlo no da error.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Habitación activa', type: HabitacionAdminResponseDto })
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  reactivar(@Param('id', idUuid('id')) id: string, @UsuarioActual() usuario: Usuario) {
    return this.habitacionesAdminService.cambiarEstado(id, true, usuario);
  }
}
