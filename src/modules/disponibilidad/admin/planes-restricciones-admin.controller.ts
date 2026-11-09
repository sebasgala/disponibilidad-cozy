import { Body, Controller, Get, Param, Patch, Post, Query, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RangoFechasQueryDto } from '../dto/admin/disponibilidad-admin.dto';
import {
  ActualizarPlanTarifaDto,
  CrearPlanTarifaDto,
  EditarRestriccionesDto,
  PlanTarifaAdminResponseDto,
  RestriccionesAdminResponseDto,
} from '../dto/admin/planes-restricciones-admin.dto';
import { RolUsuario, UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { ProblemDetailsFilter } from '../../comun/problems/problem-details.filter';
import { respuestaProblema } from '../../comun/problems/respuestas-swagger';
import { idUuid, validacionAdmin } from '../../comun/problems/validacion.pipes';
import { JwtAuthGuard } from '../../usuarios/seguridad/jwt-auth.guard';
import { Roles, UsuarioActual } from '../../usuarios/seguridad/roles.decorator';
import { RolesGuard } from '../../usuarios/seguridad/roles.guard';
import { PlanesAdminService } from './planes-admin.service';
import { RestriccionesAdminService } from './restricciones-admin.service';

// ─────────────────────────────────────────────────────────────────────────────
// Planes de tarifa adicionales y restricciones por noche de una habitación (/api/v1/admin/...).
// NO es parte del contrato: es lo que el dueño edita para que el contrato v2 (/api/v2) los venda y los haga cumplir.
// Exige login y rol administrador o superadmin; el alcance lo decide el catálogo (CatalogoPuerto.habitacionAdministrable).
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Interno - Admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMINISTRADOR, RolUsuario.SUPERADMIN)
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin')
export class PlanesRestriccionesAdminController {
  constructor(
    private readonly planes: PlanesAdminService,
    private readonly restricciones: RestriccionesAdminService,
  ) {}

  @Get('habitaciones/:id/planes')
  @ApiOperation({ summary: 'Planes de tarifa adicionales de una habitación', description: 'El plan por defecto ESTANDAR no aparece: sale de la habitación.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiResponse({ status: 200, description: 'Planes, activos e inactivos', type: [PlanTarifaAdminResponseDto] })
  @ApiResponse(respuestaProblema(400, 'Id inválido'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  listarPlanes(@Param('id', idUuid('id')) id: string, @UsuarioActual() usuario: Usuario) {
    return this.planes.listar(id, usuario);
  }

  @Post('habitaciones/:id/planes')
  @ApiOperation({ summary: 'Crear un plan de tarifa adicional', description: 'El código es único en la habitación y no cambia. ESTANDAR está reservado.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiResponse({ status: 201, description: 'Plan creado', type: PlanTarifaAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  @ApiResponse(respuestaProblema(409, 'Ya existe un plan con ese código en la habitación'))
  crearPlan(@Param('id', idUuid('id')) id: string, @Body() dto: CrearPlanTarifaDto, @UsuarioActual() usuario: Usuario) {
    return this.planes.crear(id, dto, usuario);
  }

  @Patch('planes/:planId')
  @ApiOperation({ summary: 'Editar un plan de tarifa', description: 'Solo cambian los campos enviados. activo = false lo saca de la venta.' })
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Plan actualizado', type: PlanTarifaAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el plan no existe'))
  actualizarPlan(@Param('planId') planId: string, @Body() dto: ActualizarPlanTarifaDto, @UsuarioActual() usuario: Usuario) {
    return this.planes.actualizar(planId, dto, usuario);
  }

  @Get('habitaciones/:id/restricciones')
  @ApiOperation({ summary: 'Restricciones por noche de una habitación', description: 'desde y hasta incluidos, máximo 366 días. Solo las noches con alguna restricción.' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiResponse({ status: 200, description: 'Restricciones del rango', type: RestriccionesAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Fechas inválidas, hasta anterior a desde o más de 366 días'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  listarRestricciones(@Param('id', idUuid('id')) id: string, @Query() rango: RangoFechasQueryDto, @UsuarioActual() usuario: Usuario) {
    return this.restricciones.listar(id, rango.desde, rango.hasta, usuario);
  }

  @Patch('habitaciones/:id/restricciones')
  @ApiOperation({
    summary: 'Editar las restricciones de un rango de noches',
    description: 'Cambia solo los campos enviados en cada noche de [desde, hasta]. null quita una restricción numérica. Todo o nada.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Habitación' })
  @ApiResponse({ status: 200, description: 'Restricciones del rango después del cambio', type: RestriccionesAdminResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, rango mayor a 366 días o estancia mínima mayor que la máxima'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: la habitación no existe'))
  editarRestricciones(@Param('id', idUuid('id')) id: string, @Body() dto: EditarRestriccionesDto, @UsuarioActual() usuario: Usuario) {
    return this.restricciones.editar(id, dto, usuario);
  }
}
