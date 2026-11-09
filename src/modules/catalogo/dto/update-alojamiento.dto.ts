import { PartialType } from '@nestjs/swagger';
import { CreateAlojamientoDto } from './create-alojamiento.dto';

/**
 * Para la actualización parcial (PATCH) todos los campos de CreateAlojamientoDto
 * son opcionales. PartialType de @nestjs/swagger conserva los decoradores de
 * class-validator y de Swagger.
 */
export class UpdateAlojamientoDto extends PartialType(CreateAlojamientoDto) {}
