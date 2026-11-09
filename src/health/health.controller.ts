import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DataSource } from 'typeorm';

const ESPERA_MAXIMA_MS = 3000;

export class SaludDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: 'ok' | 'error';

  @ApiProperty({ enum: ['up', 'down'], example: 'up', description: 'Resultado de `SELECT 1` contra PostgreSQL' })
  database: 'up' | 'down';

  @ApiProperty({ description: 'Segundos desde que arrancó la aplicación', example: 120 })
  uptime: number;
}

// Comprobación de salud para Render y para Docker (HEALTHCHECK). No es parte del contrato.
// Responde 200 si la base contesta y 503 si no, sin revelar el motivo (los detalles van al log del servidor).
@ApiTags('Interno - Salud')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Estado del servicio y de la conexión a la base de datos' })
  @ApiResponse({ status: 200, description: 'La aplicación y la base de datos responden', type: SaludDto })
  @ApiResponse({ status: 503, description: 'La base de datos no responde', type: SaludDto })
  async comprobar(@Res({ passthrough: true }) res: Response): Promise<SaludDto> {
    res.setHeader('Cache-Control', 'no-store');
    const uptime = Math.round(process.uptime());
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('La base no contestó a tiempo')), ESPERA_MAXIMA_MS).unref()),
      ]);
      return { status: 'ok', database: 'up', uptime };
    } catch (error) {
      console.error('[health] falló la comprobación de la base de datos:', (error as Error).message);
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', database: 'down', uptime };
    }
  }
}
