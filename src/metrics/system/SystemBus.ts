import os from 'os';
import { RedisClient } from '@/redis/client';
import type { SystemSnapshot } from '@/custom-types';
import { NodeOsProvider } from '@/metrics/node-os';
import { SiProvider } from '@/metrics/systemInformation';

export class SystemBus {
  private static _i: SystemBus | null = null;
  static get(): SystemBus {
    return (this._i ??= new SystemBus());
  }

  // 👉 systeminformation como principal; fallback a NodeOsProvider si no está disponible
  private provider = SiProvider.isAvailable() ? new SiProvider() : new NodeOsProvider();

  private instanceId = process.env.INSTANCE_ID || `${os.hostname()}-${process.pid}`;
  private lastLocal: SystemSnapshot | null = null;

  // 👇 TIMER COMPATIBLE (Node/DOM)
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.publishOnce().catch(() => {});
    }, 1000);
    // Unref si corre en Node (en navegador no existe)
    (this.timer as any).unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async publishOnce(): Promise<void> {
    const redis = RedisClient.get();
    const snap = await this.provider.snapshot();
    this.lastLocal = snap;

    if (!redis) return;
    const key = `metrics:sys:${this.instanceId}`;
    await redis.set(key, JSON.stringify(snap), 'EX', 5); // TTL 5s
  }

  /** Agrega snapshots de todas las instancias publicadas (fallback: local) */
  async aggregate(): Promise<SystemSnapshot> {
    const redis = RedisClient.get();
    if (!redis) {
      return this.lastLocal ?? (await this.provider.snapshot());
    }

    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', 'metrics:sys:*', 'COUNT', 50);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) {
      return this.lastLocal ?? (await this.provider.snapshot());
    }

    const snapsRaw = await redis.mget(keys);
    const snaps = snapsRaw
      .map((s) => { try { return JSON.parse(s as string); } catch { return null; } })
      .filter(Boolean) as SystemSnapshot[];

    const nowIso = new Date().toISOString();
    let cpuSum = 0, memUsed = 0, memTotal = 0, n = 0;
    let rd = 0, wr = 0, rx = 0, tx = 0;

    for (const s of snaps) {
      cpuSum += s.cpu.usagePercent; n++;
      memUsed += s.memory.usedMB;  memTotal += s.memory.totalMB;
      rd += s.disk.readMBps  ?? 0; wr += s.disk.writeMBps ?? 0;
      rx += s.network.rxKBps ?? 0; tx += s.network.txKBps ?? 0;
    }

    const memUsagePercent = memTotal > 0 ? +((memUsed / memTotal) * 100).toFixed(1) : 0;

    return {
      at: nowIso,
      cpu: { usagePercent: n ? +(cpuSum / n).toFixed(1) : 0 },
      memory: { usedMB: +memUsed.toFixed(1), totalMB: +memTotal.toFixed(1), usagePercent: memUsagePercent },
      disk: { readMBps: rd || undefined, writeMBps: wr || undefined },
      network: { rxKBps: rx || undefined, txKBps: tx || undefined },
    };
  }
}
