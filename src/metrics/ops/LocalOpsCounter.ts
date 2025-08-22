// src/metrics/ops/LocalOpsCounter.ts
import { OpsCounter, OpType, OpsSnapshot } from '@/custom-types';

type Bucket = { enc: number; dec: number };

export class LocalOpsCounter implements OpsCounter {
  private readonly windowSeconds = 60;
  private readonly buckets: Bucket[] = Array.from({ length: 60 }, () => ({ enc: 0, dec: 0 }));
  private cursor = 0;
  private cursorTime = Date.now();
  private readonly tickMs = 1000;

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.timer = setInterval(() => this.advance(), this.tickMs);
    (this.timer as any).unref?.();
  }

  record(type: OpType): void {
    const b = this.buckets[this.cursor];
    if (type === 'encrypt') b.enc += 1;
    else b.dec += 1;
  }

  async snapshot(windowSeconds = this.windowSeconds): Promise<OpsSnapshot> {
    let enc = 0,
      dec = 0;
    for (const b of this.buckets) {
      enc += b.enc;
      dec += b.dec;
    }
    return {
      windowSeconds,
      encryptCount: enc,
      decryptCount: dec,
      totalCount: enc + dec,
      at: new Date().toISOString()
    };
  }

  private advance(): void {
    const now = Date.now();
    const elapsed = Math.floor((now - this.cursorTime) / this.tickMs);
    if (elapsed <= 0) return;
    for (let i = 0; i < Math.min(elapsed, this.windowSeconds); i++) {
      this.cursor = (this.cursor + 1) % this.windowSeconds;
      this.buckets[this.cursor] = { enc: 0, dec: 0 };
    }
    this.cursorTime += elapsed * this.tickMs;
  }
}
