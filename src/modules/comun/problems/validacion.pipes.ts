import { ParseIntPipe, ParseUUIDPipe, PipeTransform, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConsultaInvalidaException, InvalidParam } from './problem-details.exceptions';
import { esFechaValida } from '../alojamientos-consulta.utils';

// Cada controlador declara su política de validación con @UsePipes (no hay pipe global): un pipe global
// con whitelist quitaría los campos extra antes de que el pipe estricto del admin pudiera rechazarlos.

// Si un campo falla varias reglas a la vez, se informa la más básica: primero "falta", luego "tipo
// incorrecto" y solo después las demás (largo, formato, mínimo...). Así un campo ausente dice "es
// obligatorio" y no cuatro motivos.
const REGLAS_DE_PRESENCIA = ['isDefined', 'isNotEmpty'];
const REGLAS_DE_TIPO = ['isString', 'isInt', 'isNumber', 'isBoolean', 'isArray', 'isObject', 'nestedValidation'];

function motivo(constraints: Record<string, string>): string {
  for (const grupo of [REGLAS_DE_PRESENCIA, REGLAS_DE_TIPO]) {
    const regla = grupo.find((nombre) => constraints[nombre]);
    if (regla) return constraints[regla];
  }
  return Object.values(constraints).join('; ');
}

// Aplana el árbol de errores de class-validator: un elemento por campo, con su ruta completa
// ("customer_details.email", "guests.allocation.0.adults").
export function aInvalidParams(errores: ValidationError[], prefijo = ''): InvalidParam[] {
  return errores.flatMap((error) => {
    const name = prefijo ? `${prefijo}.${error.property}` : error.property;
    const propios = error.constraints ? [{ name, reason: motivo(error.constraints) }] : [];
    return [...propios, ...aInvalidParams(error.children ?? [], name)];
  });
}

// Rutas del contrato: los campos extra se ignoran (respuesta oficial de los autores del contrato), pero un
// campo obligatorio ausente o con tipo incorrecto sigue dando 400 en formato ProblemDetails.
export const validacionContrato = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    exceptionFactory: (errores) => new ConsultaInvalidaException(aInvalidParams(errores)),
  });

// Rutas internas de administración: estrictas, un campo que no existe en el DTO da 400. Mismo formato
// ProblemDetails que las rutas del contrato (el controlador debe declarar también ProblemDetailsFilter).
export const validacionAdmin = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errores) => new ConsultaInvalidaException(aInvalidParams(errores)),
  });

// Ids de la ruta. Si no tienen el formato, 400 ProblemDetails con el nombre del parámetro (y no un 500 de PostgreSQL).
export const idEntero = (nombre: string) =>
  new ParseIntPipe({
    exceptionFactory: () => new ConsultaInvalidaException([{ name: nombre, reason: 'debe ser un número entero' }]),
  });

export const idUuid = (nombre: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () => new ConsultaInvalidaException([{ name: nombre, reason: 'debe ser un UUID válido' }]),
  });

// Fecha de calendario YYYY-MM-DD en la ruta (rechaza 2026-02-30).
export const fechaIso = (nombre: string): PipeTransform<string, string> => ({
  transform(valor: string) {
    if (!esFechaValida(valor)) throw new ConsultaInvalidaException([{ name: nombre, reason: 'debe ser una fecha válida YYYY-MM-DD' }]);
    return valor;
  },
});
