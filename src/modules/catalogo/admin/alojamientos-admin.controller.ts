import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res, UseFilters, UseGuards, UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AlojamientosAdminService } from './alojamientos-admin.service';
import { CreateAlojamientoDto } from '../dto/create-alojamiento.dto';
import { UpdateAlojamientoDto } from '../dto/update-alojamiento.dto';
import { FiltroAlojamientosQueryDto } from '../dto/filtro-alojamientos-query.dto';
import { FiltroHabitacionesQueryDto } from '../dto/admin/habitacion-admin.dto';
import { AlojamientoResponseDto, PaginatedAlojamientosResponseDto } from '../dto/alojamiento-response.dto';
import { RolUsuario, UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { JwtAuthGuard } from '../../usuarios/seguridad/jwt-auth.guard';
import { Roles, UsuarioActual } from '../../usuarios/seguridad/roles.decorator';
import { RolesGuard } from '../../usuarios/seguridad/roles.guard';
import { ProblemDetailsFilter } from '../../comun/problems/problem-details.filter';
import { respuestaProblema } from '../../comun/problems/respuestas-swagger';
import { idEntero, validacionAdmin } from '../../comun/problems/validacion.pipes';

// ─────────────────────────────────────────────────────────────────────────────
// CRUD de administración de alojamientos (/api/v1/admin/alojamientos).
// Es APARTE del contrato alojamientos-openapi.yaml: no usa sus rutas ni sus esquemas.
//
// Exige login y rol administrador o superadmin. Un administrador solo ve y modifica los alojamientos donde
// es propietario (AccesoAdminService); lo demás responde 404.
//
// Orden de rutas: las fijas (POST / y GET /) van antes de las rutas con :id.
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Interno - Admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMINISTRADOR, RolUsuario.SUPERADMIN)
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin/alojamientos')
export class AlojamientosAdminController {
  constructor(private readonly alojamientosAdminService: AlojamientosAdminService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un alojamiento' })
  @ApiResponse({ status: 201, description: 'Alojamiento creado. Devuelve la cabecera Location.', type: AlojamientoResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, campos no permitidos o ciudadId inexistente'))
  async crear(@Body() dto: CreateAlojamientoDto, @UsuarioActual() usuario: Usuario, @Res({ passthrough: true }) res: Response) {
    const nuevo = await this.alojamientosAdminService.crear(dto, usuario);
    res.setHeader('Location', `/api/v1/admin/alojamientos/${nuevo.id}`);
    return nuevo;
  }

  @Get()
  @ApiOperation({
    summary: 'Listar alojamientos (paginado, con filtros opcionales)',
    description: '`habitaciones` cuenta solo las activas; incluirInactivas=true cuenta todas.',
  })
  @ApiResponse({ status: 200, description: 'Página de alojamientos, incluidos los dados de baja si no se filtra por activo.', type: PaginatedAlojamientosResponseDto })
  @ApiResponse(respuestaProblema(400, 'Parámetros de consulta inválidos'))
  listar(@Query() query: FiltroAlojamientosQueryDto, @UsuarioActual() usuario: Usuario) {
    return this.alojamientosAdminService.findAll(query, usuario);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener un alojamiento por su id (también si está dado de baja)',
    description: '`habitaciones` cuenta solo las activas; incluirInactivas=true cuenta todas.',
  })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 200, description: 'Detalle del alojamiento.', type: AlojamientoResponseDto })
  @ApiResponse(respuestaProblema(400, 'El id no es un entero'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  obtener(@Param('id', idEntero('id')) id: number, @Query() conteo: FiltroHabitacionesQueryDto, @UsuarioActual() usuario: Usuario) {
    return this.alojamientosAdminService.findOne(id, usuario, conteo.incluirInactivas);
  }

  @Put(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reemplazar completamente un alojamiento' })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 204, description: 'Alojamiento reemplazado.' })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, campos no permitidos o ciudadId inexistente'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  async reemplazar(@Param('id', idEntero('id')) id: number, @Body() dto: CreateAlojamientoDto, @UsuarioActual() usuario: Usuario) {
    await this.alojamientosAdminService.reemplazar(id, dto, usuario);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar parcialmente un alojamiento' })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 200, description: 'Alojamiento actualizado.', type: AlojamientoResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos, campos no permitidos o ciudadId inexistente'))
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  actualizar(@Param('id', idEntero('id')) id: number, @Body() dto: UpdateAlojamientoDto, @UsuarioActual() usuario: Usuario) {
    return this.alojamientosAdminService.actualizar(id, dto, usuario);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Dar de baja un alojamiento (borrado lógico: activo = false)',
    description:
      'También desactiva sus habitaciones (la disponibilidad se conserva). Si tiene reservas CONFIRMED con salida posterior ' +
      'a hoy responde 409 con sus localizadores y no cambia nada. La misma regla vale para PATCH/PUT con activo=false.',
  })
  @ApiParam({ name: 'id', type: 'integer', description: 'Identificador entero del alojamiento', example: 1 })
  @ApiResponse({ status: 204, description: 'Alojamiento dado de baja. La fila no se elimina.' })
  @ApiResponse(respuestaProblema(404, 'NOT_FOUND: el alojamiento no existe'))
  @ApiResponse(respuestaProblema(409, 'Tiene reservas confirmadas vigentes; no se da de baja'))
  async eliminar(@Param('id', idEntero('id')) id: number, @UsuarioActual() usuario: Usuario) {
    await this.alojamientosAdminService.desactivar(id, usuario);
  }
}
