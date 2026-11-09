import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo.module';
import { AlojamientoV2Controller } from './catalogo-v2.controller';

// Las rutas /alojamientos/{id} de la v2 van en un módulo aparte que se importa al FINAL: Express resuelve en
// orden de registro y el contrato da precedencia a las rutas estáticas (health, eventos, orders, …) sobre {id}.
@Module({
  imports: [CatalogoModule],
  controllers: [AlojamientoV2Controller],
})
export class FichaV2Module {}

