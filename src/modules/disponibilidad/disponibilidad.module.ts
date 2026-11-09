import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeguridadUsuariosModule } from '../usuarios/usuarios.module';
import { DisponibilidadAdminController } from './admin/disponibilidad-admin.controller';
import { DisponibilidadAdminService } from './admin/disponibilidad-admin.service';
import { PlanesAdminService } from './admin/planes-admin.service';
import { PlanesRestriccionesAdminController } from './admin/planes-restricciones-admin.controller';
import { RestriccionesAdminService } from './admin/restricciones-admin.service';
import { CuposService } from './cupos.service';
import { DisponibilidadPuerto, DisponibilidadPuertoController } from './disponibilidad.puerto';
import { DisponibilidadService } from './disponibilidad.service';
import { Cotizacion } from './entities/cotizacion.entity';
import { DisponibilidadDiaria } from './entities/disponibilidad-diaria.entity';
import { PlanTarifa } from './entities/plan-tarifa.entity';
import { RestriccionDia } from './entities/restriccion-dia.entity';
import { RetencionCupos } from './entities/retencion-cupos.entity';
import { ConsumidorCatalogoWorker } from './v2/consumidor-catalogo.worker';
import { DisponibilidadV2Service } from './v2/disponibilidad-v2.service';
import { InventarioV2Controller } from './v2/inventario-v2.controller';
import { InventarioV2Service } from './v2/inventario-v2.service';
import { LimpiezaDisponibilidadService } from './v2/limpieza-disponibilidad.service';
import { StockEnvioWorker } from './v2/stock-envio.worker';
import { StockOutboxService } from './v2/stock-outbox.service';
import { VencimientoRetencionesWorker } from './v2/vencimiento-retenciones.worker';
import { CONEXION } from '../../database/conexiones';

// Dominio disponibilidad = inventario y tarifas (fase 8.0 / 9.2): cupos y precio por noche, planes, restricciones,
// cotizaciones, retenciones de cupos por orden y la outbox de stock hacia Booking. Solo registra su propio esquema
// en TypeORM; recibe CatalogoPuerto globalmente (local en el monolito o HTTP en el proceso separado).
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DisponibilidadDiaria, PlanTarifa, RestriccionDia, Cotizacion, RetencionCupos], CONEXION.disponibilidad), SeguridadUsuariosModule],
  // InventarioV2Controller tiene /alojamientos/eventos: se registra antes que las rutas /alojamientos/{id}
  controllers: [DisponibilidadAdminController, PlanesRestriccionesAdminController, InventarioV2Controller, DisponibilidadPuertoController],
  providers: [
    DisponibilidadService,
    CuposService,
    DisponibilidadPuerto,
    DisponibilidadV2Service,
    InventarioV2Service,
    StockOutboxService,
    StockEnvioWorker,
    ConsumidorCatalogoWorker,
    VencimientoRetencionesWorker,
    LimpiezaDisponibilidadService,
    PlanesAdminService,
    RestriccionesAdminService,
    DisponibilidadAdminService,
  ],
  exports: [DisponibilidadPuerto],
})
export class DisponibilidadModule {}
