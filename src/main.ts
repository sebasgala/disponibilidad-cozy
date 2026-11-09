import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { arrancarModulo, conexionUnicaModulo } from './bootstrap-modulo';
import { CommonModule } from './common/common.module';
import { crearControladorSaludModulo } from './health/salud-modulo';
import { CatalogoPuertosHttpModule } from './modules/catalogo/catalogo-puerto.http';
import { ComunDominioModule } from './modules/comun/comun.module';
import { DisponibilidadModule } from './modules/disponibilidad/disponibilidad.module';

const SaludDisponibilidadController = crearControladorSaludModulo('disponibilidad');

// Proceso separado del módulo disponibilidad (fase 9.2): conecta solo como cozy_disponibilidad y registra únicamente sus entidades.
// Consulta el catálogo mediante CatalogoPuertoHttp (D1).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    conexionUnicaModulo('disponibilidad'),
    CommonModule,
    ComunDominioModule,
    CatalogoPuertosHttpModule,
    DisponibilidadModule,
  ],
  controllers: [SaludDisponibilidadController],
})
export class DisponibilidadAppModule {}

if (require.main === module) {
  void arrancarModulo({
    modulo: 'disponibilidad',
    puertoPorDefecto: 3003,
    variablePuerto: 'PORT_DISPONIBILIDAD',
    AppModulo: DisponibilidadAppModule,
  });
}

