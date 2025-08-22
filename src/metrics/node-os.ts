import os from 'os';
import { SystemMetricsProvider, SystemSnapshot } from '@/custom-types';

export class NodeOsProvider implements SystemMetricsProvider {
  private lastCpu = os.cpus();

  private cpuPercent(): number {
    const curr = os.cpus();
    let idleDiff = 0,
      totalDiff = 0;
    curr.forEach((c, i) => {
      const p = this.lastCpu[i];
      const idle = c.times.idle - p.times.idle;
      const total = c.times.user - p.times.user + (c.times.nice - p.times.nice) + (c.times.sys - p.times.sys) + (c.times.irq - p.times.irq) + idle;
      idleDiff += idle;
      totalDiff += total;
    });
    this.lastCpu = curr;
    const usage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
    return Math.max(0, Math.min(100, +usage.toFixed(1)));
  }

  async snapshot(): Promise<SystemSnapshot> {
    const totalMB = os.totalmem() / (1024 * 1024);
    const freeMB = os.freemem() / (1024 * 1024);
    const usedMB = totalMB - freeMB;
    const usagePercent = +((usedMB / totalMB) * 100).toFixed(1);
    return {
      at: new Date().toISOString(),
      cpu: { usagePercent: this.cpuPercent() },
      memory: { usedMB: +usedMB.toFixed(1), totalMB: +totalMB.toFixed(1), usagePercent },
      disk: {},
      network: {}
    };
  }
}
