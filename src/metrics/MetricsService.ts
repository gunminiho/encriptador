import { LocalOpsCounter } from '@/metrics/ops/LocalOpsCounter';
import { RedisOpsCounter } from '@/metrics/ops/RedisOpsCounter';
import type { OpsCounter, OpsSnapshot, OpType } from '@/custom-types';
import { RedisClient } from '@/redis/client';
import { SystemBus } from './system/SystemBus';
import type { SystemSnapshot } from '@/custom-types';
import { SiProvider } from '@/metrics/systemInformation';
import { NodeOsProvider } from '@/metrics/node-os';

export class MetricsService {
  private static _i: MetricsService | null = null;
  static get(): MetricsService {
    return (this._i ??= new MetricsService());
  }

  private ops: OpsCounter;
  private localOps: LocalOpsCounter;
  private systemBus = SystemBus.get();

  private constructor() {
    // contador local siempre (para fallback y latencia 0)
    this.localOps = new LocalOpsCounter();
    // si hay redis, usamos RedisOpsCounter además
    this.ops = RedisClient.get() ? new RedisOpsCounter() : this.localOps;

    // publicar snapshots del sistema cada 1s (a Redis si existe)
    this.systemBus.start();
  }

  async recordOperation(type: OpType): Promise<void> {
    // siempre registra local para UI inmediata
    this.localOps.record(type);
    // y si hay Redis, registra global
    if (this.ops !== this.localOps) await this.ops.record(type);
  }

  async opsSnapshot(): Promise<OpsSnapshot> {
    // si usamos Redis, consulta Redis; si no, local
    console.log('Obteniendo snapshot de operaciones...');
    if (this.ops !== this.localOps) return this.ops.snapshot();
    return this.localOps.snapshot();
  }

  async systemSnapshot(): Promise<SystemSnapshot> {
    return this.systemBus.aggregate();
  }
}
