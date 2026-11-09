import { Controller, Get, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TipoEvento } from '../../comun/entities/feed-evento.entity';
import { AutenticacionV2Guard, PrincipalV2 } from '../../usuarios/v2/autenticacion-v2';
import { OperacionV2 } from '../../usuarios/v2/seguridad-v2';
import { idAlojamientoV2 } from '../../comun/v2/id-alojamiento-v2';
import { EventosQueryV2, InventarioQueryV2 } from './dto/inventario-v2.dto';
import { EventosService } from '../../comun/v2/eventos.service';
import { InventarioV2Service } from './inventario-v2.service';
import { CatalogoPuerto } from '../../catalogo/catalogo.puerto';
import { ProblemaV2Filter } from '../../comun/v2/problemas-v2';
import { validacionConsultaV2 } from '../../comun/v2/validacion-v2';

// Sincronización de stock del contrato v2 (§5): feed de eventos e inventario de conciliación. Solo máquina a máquina
// (SERVICE) y administradores. Se registra ANTES que AlojamientoV2Controller: /alojamientos/eventos es una ruta estática.
@ApiTags('Contrato v2 - Telemetría y Salud de Nodo')
@Controller({ path: 'alojamientos', version: '2' })
@UseFilters(ProblemaV2Filter)
@UseGuards(AutenticacionV2Guard)
export class InventarioV2Controller {
  constructor(
    private readonly eventos: EventosService,
    private readonly inventario: InventarioV2Service,
    private readonly catalogo: CatalogoPuerto,
  ) {}

  private principal(req: Request): PrincipalV2 {
    return (req as Request & { principalV2: PrincipalV2 }).principalV2;
  }

  @Get('eventos')
  @ApiOperation({ operationId: 'listOutboxEvents', summary: 'Feed Transactional Outbox (CloudEvents) para RabbitMQ / EDA' })
  @OperacionV2('listOutboxEvents')
  async listarEventos(@Req() req: Request, @Query(validacionConsultaV2()) consulta: EventosQueryV2) {
    // Un administrador (no superadmin) solo ve los eventos de sus alojamientos: cuáles son lo dice el catálogo
    const principal = this.principal(req);
    const alojamientos = principal.rol === 'ADMIN' && !principal.superadmin ? await this.catalogo.idsDeAlojamientosDe(principal.usuarioId) : null;
    return this.eventos.listar(consulta.after, consulta.limit, consulta.type as TipoEvento | undefined, alojamientos);
  }

  @Get(':id/inventario')
  @ApiOperation({ operationId: 'getInventorySnapshot', summary: 'Inventario por noche y tipo de habitación (conciliación con Booking)' })
  @OperacionV2('getInventorySnapshot')
  snapshot(@Req() req: Request, @Param('id', idAlojamientoV2) id: string, @Query(validacionConsultaV2()) consulta: InventarioQueryV2) {
    return this.inventario.snapshot(id, consulta.desde, consulta.hasta, consulta.tipoHabitacion, this.principal(req));
  }
}
