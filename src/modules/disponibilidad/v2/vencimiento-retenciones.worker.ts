import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CuposService } from '../cupos.service';
import { CONEXION } from '../../../database/conexiones';

// Barrido de retenciones provisionales vencidas (saga de 8.4, decisión 3): una retención que nadie confirmó en 15 minutos
// vuelve a dar sus cupos. Es la red de seguridad si reservas no llega a compensar (el barrido de sagas de reservas lo
// hace mucho antes). Cada orden se libera en su propia transacción y con la fila bloqueada, así una saga que confirma
// a la vez gana o pierde entera. No avisa stock a Booking: una retención provisional nunca se le avisó.

const INTERVALO_MS = 60_000;
const POR_VUELTA = 50;

@Injectable()
export class VencimientoRetencionesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('VencimientoRetenciones');
  private temporizador: NodeJS.Timeout | null = null;
  private activo: Promise<number> | null = null;

  constructor(
    @InjectDataSource(CONEXION.disponibilidad) private readonly dataSource: DataSource,
    private readonly cupos: CuposService,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => {
      if (this.activo) return;
      this.activo = this.vuelta(new Date())
        .catch((e) => {
          this.log.error(`Barrido de retenciones con error: ${(e as Error).message}`);
          return 0;
        })
        .finally(() => (this.activo = null));
    }, INTERVALO_MS);
    this.temporizador.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.activo;
  }

  // Devuelve cuántas liberó
  async vuelta(ahora: Date): Promise<number> {
    const ordenes = await this.cupos.vencidas(this.dataSource.manager, ahora, POR_VUELTA);
    let liberadas = 0;
    for (const ordenId of ordenes) {
      if (await this.dataSource.transaction((manager) => this.cupos.liberarSiVencida(manager, ordenId, ahora))) liberadas++;
    }
    if (liberadas > 0) this.log.log(`Retenciones provisionales vencidas liberadas: ${liberadas}`);
    return liberadas;
  }
}
