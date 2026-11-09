import { PipeTransform } from '@nestjs/common';
import { peticionInvalida } from './problemas-v2';

// AlojamientoId del contrato. Las palabras de las rutas estáticas no son ids válidos.
const ID_ALOJAMIENTO = /^(?!(health|eventos|categorias|tipos|orders|reservations|reservas|search|availability|promociones)$)[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export const idAlojamientoV2: PipeTransform<string, string> = {
  transform(valor: string) {
    if (!ID_ALOJAMIENTO.test(valor)) {
      throw peticionInvalida([{ name: 'id', reason: 'debe tener entre 3 y 64 caracteres (letras, números, punto, guion o guion bajo) y no ser una palabra reservada' }]);
    }
    return valor;
  },
};
