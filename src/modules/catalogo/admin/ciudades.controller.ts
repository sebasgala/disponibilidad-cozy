import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CiudadesService } from './ciudades.service';
import { CreateCiudadDto } from '../dto/create-ciudad.dto';
import { CiudadResponseDto } from '../dto/ciudad-response.dto';
import { RolUsuario, UsuarioSesion as Usuario } from '../../usuarios/usuarios.contrato';
import { JwtAuthGuard } from '../../usuarios/seguridad/jwt-auth.guard';
import { Roles, UsuarioActual } from '../../usuarios/seguridad/roles.decorator';
import { RolesGuard } from '../../usuarios/seguridad/roles.guard';
import { ProblemDetailsFilter } from '../../comun/problems/problem-details.filter';
import { respuestaProblema } from '../../comun/problems/respuestas-swagger';
import { validacionAdmin } from '../../comun/problems/validacion.pipes';

// Ciudades mínimas para poder elegir ciudadId al crear alojamientos.
// Exige login y rol administrador o superadmin. Las ciudades son un catálogo común: no tienen propietario.
@ApiTags('Interno - Admin')
@ApiBearerAuth('JWT')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMINISTRADOR, RolUsuario.SUPERADMIN)
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('admin/ciudades')
export class CiudadesController {
  constructor(private readonly ciudadesService: CiudadesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar ciudades (ordenadas por nombre)' })
  @ApiResponse({ status: 200, description: 'Lista de ciudades.', type: [CiudadResponseDto] })
  listar() {
    return this.ciudadesService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una ciudad' })
  @ApiResponse({ status: 201, description: 'Ciudad creada.', type: CiudadResponseDto })
  @ApiResponse(respuestaProblema(400, 'Datos inválidos o campos no permitidos'))
  @ApiResponse(respuestaProblema(409, 'Ya existe una ciudad con ese nombre y país'))
  crear(@Body() dto: CreateCiudadDto, @UsuarioActual() usuario: Usuario) {
    return this.ciudadesService.crear(dto, usuario);
  }
}
