import type { SystemMetricsProvider, SystemSnapshot } from '@/custom-types';

export class SiProvider implements SystemMetricsProvider {
  static isAvailable(): boolean {
    try { require.resolve('systeminformation'); return true; } catch { return false; }
  }

  async snapshot(): Promise<SystemSnapshot> {
    const si = await import('systeminformation');

    const [load, mem, io, nets, fs] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.disksIO(),
      si.networkStats(),
      si.fsSize().catch(() => []),
    ]);

    // 👇 compat: currentLoad vs currentload
    const rawLoad = (load as any).currentLoad ?? (load as any).currentload ?? 0;
    const cpuPct = Number.isFinite(rawLoad) ? +Number(rawLoad).toFixed(1) : 0;

    const totalMB = mem.total / (1024 * 1024);
    const usedMB  = (mem.total - mem.available) / (1024 * 1024);
    const memPct  = totalMB > 0 ? +((usedMB / totalMB) * 100).toFixed(1) : 0;

    const net = Array.isArray(nets) ? nets[0] : (nets as any);
    const disk = io as any;

    let diskUsedPercent: number | undefined;
    if (Array.isArray(fs) && fs.length) {
      const parts = fs.map((d: any) => d.use).filter((v: any) => typeof v === 'number');
      if (parts.length) diskUsedPercent = +(parts.reduce((a: number, b: number) => a + b, 0) / parts.length).toFixed(1);
    }

    return {
      at: new Date().toISOString(),
      cpu: { usagePercent: cpuPct },
      memory: { usedMB: +usedMB.toFixed(1), totalMB: +totalMB.toFixed(1), usagePercent: memPct },
      disk: {
        // compat rIO_sec/wIO_sec pueden no venir en todos los SO
        readMBps:  disk?.rIO_sec ? +(disk.rIO_sec / (1024 * 1024)).toFixed(2) : undefined,
        writeMBps: disk?.wIO_sec ? +(disk.wIO_sec / (1024 * 1024)).toFixed(2) : undefined,
        usedPercent: diskUsedPercent,
      },
      network: {
        rxKBps: net?.rx_sec ? +(net.rx_sec / 1024).toFixed(1) : undefined,
        txKBps: net?.tx_sec ? +(net.tx_sec / 1024).toFixed(1) : undefined,
      },
    };
  }
}
