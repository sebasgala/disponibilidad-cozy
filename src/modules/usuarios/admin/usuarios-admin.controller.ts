import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CambiarRolDto, FiltroUsuariosQueryDto, UsuariosPaginadosDto } from '../dto/admin/usuario-admin.dto';
import { UsuarioResponseDto } from '../dto/auth/auth.dto';
import { RolUsuario } from '../entities/usuario.entity';
import { ProblemDetailsFilter } from '../../comun/problems/problem-details.filter';
import { respuestaProblema } from '../../comun/problems/respuestas-swagger';
import { idUuid, validacionAdmin } from '../../comun/problems/validacion.pipes';
import { JwtAuthGuard } from '../seguridad/jwt-auth.guard';
import { Roles, UsuarioActual } from '../seguridad/roles.decorator';
import { RolesGuard } from '../seguridad/roles.guard';
import { SesionJwt } from '../seguridad/seguridad.tipos';
import { UsuariosAdminService } from './usuarios-admin.service';

const R401 = respuestaProblema(401, 'UNAUTHORIZED: falta el token o no es válido');
const R403 = respuestaProblema(403, 'FORBIDDEN: solo el superadmin');
const R404 = respuestaProblema(404, 'NOT_FOUND: el usuario no existe');

// Gestión de cuentas: SOLO superadmin. Un administrador recibe 403.
@ApiTags('Interno - Admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.SUPERADMIN)
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin/usuarios')
export class UsuariosAdminController {
  constructor(private readonly usuariosAdminService: UsuariosAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios', description: 'Filtros opcionales por rol y estado (p. ej. estado=pendiente para ver quién espera aprobación).' })
  @ApiResponse({ status: 200, description: 'Página de usuarios (sin contraseñas)', type: UsuariosPaginadosDto })
  @ApiResponse(respuestaProblema(400, 'Filtros inválidos'))
  @ApiResponse(R401)
  @ApiResponse(R403)
  listar(@Query() filtro: FiltroUsuariosQueryDto) {
    return this.usuariosAdminService.listar(filtro);
  }

  @Post(':id/aprobar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar un administrador pendiente', description: 'pendiente -> activo. Idempotente. Si está suspendido: 409 (usa reactivar).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuario activo', type: UsuarioResponseDto })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  @ApiResponse(respuestaProblema(409, 'La cuenta está suspendida'))
  aprobar(@Param('id', idUuid('id')) id: string, @UsuarioActual() actor: SesionJwt) {
    return this.usuariosAdminService.aprobar(id, actor);
  }

  @Post(':id/suspender')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspender una cuenta', description: 'activo -> suspendido. Idempotente. No puedes suspenderte a ti mismo; una cuenta pendiente da 409.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuario suspendido', type: UsuarioResponseDto })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  @ApiResponse(respuestaProblema(409, 'Es tu propia cuenta o está pendiente'))
  suspender(@Param('id', idUuid('id')) id: string, @UsuarioActual() actor: SesionJwt) {
    return this.usuariosAdminService.suspender(id, actor);
  }

  @Post(':id/reactivar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivar una cuenta suspendida', description: 'suspendido -> activo. Idempotente. Una cuenta pendiente da 409 (usa aprobar).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuario activo', type: UsuarioResponseDto })
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  @ApiResponse(respuestaProblema(409, 'La cuenta está pendiente'))
  reactivar(@Param('id', idUuid('id')) id: string, @UsuarioActual() actor: SesionJwt) {
    return this.usuariosAdminService.reactivar(id, actor);
  }

  @Patch(':id/rol')
  @ApiOperation({ summary: 'Cambiar el rol de un usuario', description: 'Idempotente. No puedes cambiar tu propio rol.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Usuario con el nuevo rol', type: UsuarioResponseDto })
  @ApiResponse(respuestaProblema(400, 'Rol inválido o campos no permitidos'))
  @ApiResponse(R401)
  @ApiResponse(R403)
  @ApiResponse(R404)
  @ApiResponse(respuestaProblema(409, 'Es tu propia cuenta'))
  cambiarRol(@Param('id', idUuid('id')) id: string, @Body() dto: CambiarRolDto, @UsuarioActual() actor: SesionJwt) {
    return this.usuariosAdminService.cambiarRol(id, dto, actor);
  }
}
