import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeguridadUsuariosModule } from '../usuarios/usuarios.module';
import { AccesoAdminService } from './admin/acceso-admin.service';
import { AlojamientosAdminController } from './admin/alojamientos-admin.controller';
import { AlojamientosAdminService } from './admin/alojamientos-admin.service';
import { CiudadesController } from './admin/ciudades.controller';
import { CiudadesService } from './admin/ciudades.service';
import { HabitacionesAdminController } from './admin/habitaciones-admin.controller';
import { HabitacionesAdminService } from './admin/habitaciones-admin.service';
import { AlojamientosController } from './alojamientos.controller';
import { AlojamientosService } from './alojamientos.service';
import { BusCatalogoService } from './bus-catalogo.service';
import { CatalogoPuertoController } from './catalogo-puerto.http';
import { CatalogoPuerto } from './catalogo.puerto';
import { ConsultasV1Service } from './consultas-v1.service';
import { Alojamiento } from './entities/alojamiento.entity';
import { Ciudad } from './entities/ciudad.entity';
import { Habitacion } from './entities/habitacion.entity';
import { CatalogoV2Controller, SaludV2Controller } from './v2/catalogo-v2.controller';
import { CatalogoV2Service } from './v2/catalogo-v2.service';
import { PoliticaPaquetesService } from './v2/politica-paquetes.service';
import { CONEXION } from '../../database/conexiones';

// Dominio catálogo (fase 8.0 / 9.2): ciudades, alojamientos y habitaciones, más las rutas públicas de búsqueda,
// disponibilidad informativa y fichas (v1 y v2). Solo lee sus tablas; no registra la entidad Usuario.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Alojamiento, Ciudad, Habitacion], CONEXION.catalogo), SeguridadUsuariosModule],
  controllers: [
    AlojamientosAdminController,
    CiudadesController,
    HabitacionesAdminController,
    AlojamientosController,
    SaludV2Controller,
    CatalogoV2Controller,
    CatalogoPuertoController,
  ],
  providers: [
    CatalogoPuerto,
    BusCatalogoService,
    AccesoAdminService,
    AlojamientosService,
    AlojamientosAdminService,
    CiudadesService,
    HabitacionesAdminService,
    CatalogoV2Service,
    ConsultasV1Service,
    PoliticaPaquetesService,
  ],
  exports: [CatalogoPuerto, AlojamientosService, CatalogoV2Service, ConsultasV1Service, PoliticaPaquetesService],
})
export class CatalogoModule {}
