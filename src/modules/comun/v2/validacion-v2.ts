import { ValidationPipe } from '@nestjs/common';
import { aInvalidParams } from '../problems/validacion.pipes';
import { peticionInvalida } from './problemas-v2';

// Validación de la v2. El cuerpo es estricto (el contrato exige 400 ante un campo desconocido); la query ignora lo que
// no conoce. Un campo ausente o con tipo incorrecto da 400 VALIDATION_FAILED con invalid_params.
const comun = {
  whitelist: true,
  transform: true,
  exceptionFactory: (errores: Parameters<typeof aInvalidParams>[0]) =>
    peticionInvalida(aInvalidParams(errores).map(({ name, reason }) => ({ name: name.slice(0, 100), reason: reason.slice(0, 300) }))),
};

export const validacionCuerpoV2 = () => new ValidationPipe({ ...comun, forbidNonWhitelisted: true });
export const validacionConsultaV2 = () => new ValidationPipe({ ...comun, forbidNonWhitelisted: false });
