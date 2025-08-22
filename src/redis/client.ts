// src/metrics/redis/client.ts
import Redis, { type Redis as RedisType } from 'ioredis';

let disabled = false;

export class RedisClient {
  private static instance: RedisType | null = null;

  static get(): RedisType | null {
    if (disabled) return null;
    if (this.instance) return this.instance;

    const url = process.env.REDIS_URL;
    if (!url) return null;

    try {
      const u = new URL(url);
      const isTLS = u.protocol === 'rediss:';
      const insecure = process.env.REDIS_TLS_INSECURE === '1';

      const redis = new Redis(url, {
        lazyConnect: true,
        enableAutoPipelining: true,
        maxRetriesPerRequest: 1,
        // sólo setea tls cuando el esquema es rediss://
        tls: isTLS ? (insecure ? { rejectUnauthorized: false } : {}) : undefined
      });

      redis.on('error', (e) => {
        // Evita spam infinito si la URL es inválida (p.ej. rediss contra 6379)
        if (String(e?.message || '').includes('wrong version number') || String(e?.message || '').includes('self signed certificate')) {
          console.error('[redis] deshabilitado por error de conexión:', e.message);
          try {
            redis.disconnect();
          } catch {}
          disabled = true;
          this.instance = null;
          return;
        }
        console.error('[redis] error', e?.message);
      });

      this.instance = redis;
      return this.instance;
    } catch (e: any) {
      console.error('[redis] URL inválida:', e?.message);
      disabled = true;
      return null;
    }
  }
}
