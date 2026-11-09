import { getSchemaPath } from '@nestjs/swagger';
import { ProblemDetailsDto } from '../dto/problem-details.dto';

// Respuesta de error documentada como application/problem+json con el esquema ProblemDetails.
// La usan las rutas internas de administración (las del contrato tienen su propia copia en su controlador).
export const respuestaProblema = (status: number, description: string) => ({
  status,
  description,
  content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDetailsDto) } } },
});
