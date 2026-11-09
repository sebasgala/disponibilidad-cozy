import { Controller, Get, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsuarioResponseDto } from '../dto/auth/auth.dto';
import { ProblemDetailsFilter } from '../../comun/problems/problem-details.filter';
import { respuestaProblema } from '../../comun/problems/respuestas-swagger';
import { validacionAdmin } from '../../comun/problems/validacion.pipes';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsuarioActual } from './roles.decorator';
import { SesionJwt } from './seguridad.tipos';

// Cuenta del cliente. Rutas internas (no son parte del contrato). Las reservas de la cuenta están en
// reservas/cuenta-reservas.controller.ts (fase 8.0).
@ApiTags('Interno - Cuenta')
@UsePipes(validacionAdmin())
@UseFilters(ProblemDetailsFilter)
@Controller('cuenta')
export class CuentaController {
  constructor(private readonly authService: AuthService) {}

  @Get('perfil')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Mi perfil' })
  @ApiResponse({ status: 200, description: 'Datos de mi cuenta', type: UsuarioResponseDto })
  @ApiResponse(respuestaProblema(401, 'UNAUTHORIZED: falta el token o no es válido'))
  perfil(@UsuarioActual() sesion: SesionJwt) {
    return this.authService.cuentaDe(sesion.id);
  }
}
