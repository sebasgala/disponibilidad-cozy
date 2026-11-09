import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

// Fecha de calendario `YYYY-MM-DD` (format: date del contrato): sin hora y válida (rechaza 2026-02-30).
export function IsFechaIso() {
  return applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: (args) => `${args.property} debe tener formato YYYY-MM-DD` }),
    IsISO8601({ strict: true }, { message: (args) => `${args.property} debe ser una fecha válida` }),
  );
}
