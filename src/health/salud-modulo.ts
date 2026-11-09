import { Controller, Get, HttpStatus, Res, Type, VERSION_NEUTRAL } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { CONEXION, ModuloConRol } from '../database/conexiones';

const ESPERA_MAXIMA_MS = 3000;

export interface SaludModuloRespuesta {
  status: 'ok' | 'error';
  modulo: ModuloConRol;
  database: 'up' | 'down';
  uptime: number;
}

// GET /health sin prefijo de versión (VERSION_NEUTRAL) para cada proceso separado (fase 9.2).
// Consulta únicamente el DataSource de su propio módulo.
export function crearControladorSaludModulo(modulo: ModuloConRol): Type<unknown> {
  const nombreConexion = modulo === 'comun' ? undefined : CONEXION[modulo];

  @Controller({ path: 'health', version: VERSION_NEUTRAL })
  class SaludModuloController {
    constructor(@InjectDataSource(nombreConexion) readonly dataSource: DataSource) {}

    @Get()
    async comprobar(@Res({ passthrough: true }) res: Response): Promise<SaludModuloRespuesta> {
      res.setHeader('Cache-Control', 'no-store');
      const uptime = Math.round(process.uptime());
      try {
        await Promise.race([
          this.dataSource.query('SELECT 1'),
          new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('La base no contestó a tiempo')), ESPERA_MAXIMA_MS).unref()),
        ]);
        return { status: 'ok', modulo, database: 'up', uptime };
      } catch (error) {
        console.error(`[health:${modulo}] falló la comprobación de la base de datos:`, (error as Error).message);
        res.status(HttpStatus.SERVICE_UNAVAILABLE);
        return { status: 'error', modulo, database: 'down', uptime };
      }
    }
  }

  return SaludModuloController;
}

