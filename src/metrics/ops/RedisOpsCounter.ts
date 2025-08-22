import { RedisClient } from '@/redis/client';
import { OpsCounter, OpType, OpsSnapshot } from '@/custom-types';

export class RedisOpsCounter implements OpsCounter {
  private readonly windowSeconds = 60;
  private readonly keyPrefix = 'metrics:ops';

  async record(type: OpType): Promise<void> {
    const redis = RedisClient.get();
    if (!redis) return; // si no hay Redis, no hacemos nada aquí (usa LocalOpsCounter como fallback)
    const sec = Math.floor(Date.now() / 1000);
    const key = `${this.keyPrefix}:${sec}`;
    const field = type === 'encrypt' ? 'enc' : 'dec';
    await redis
      .multi()
      .hincrby(key, field, 1)
      .expire(key, 180) // 3 min por seguridad
      .exec();
  }

  async snapshot(windowSeconds = this.windowSeconds): Promise<OpsSnapshot> {
    const redis = RedisClient.get();
    if (!redis) {
      // si no hay redis, el caller debe usar LocalOpsCounter
      return { windowSeconds, encryptCount: 0, decryptCount: 0, totalCount: 0, at: new Date().toISOString() };
    }
    const now = Math.floor(Date.now() / 1000);
    const keys: string[] = [];
    for (let s = now - windowSeconds + 1; s <= now; s++) keys.push(`${this.keyPrefix}:${s}`);
    const pipeline = redis.pipeline();
    keys.forEach((k) => pipeline.hmget(k, 'enc', 'dec'));
    const rows = await pipeline.exec();

    let enc = 0,
      dec = 0;
    for (const [, val] of rows ?? []) {
      const [e, d] = (val as (string | null)[]) ?? [];
      enc += Number(e || 0);
      dec += Number(d || 0);
    }
    return {
      windowSeconds,
      encryptCount: enc,
      decryptCount: dec,
      totalCount: enc + dec,
      at: new Date().toISOString()
    };
  }
}
