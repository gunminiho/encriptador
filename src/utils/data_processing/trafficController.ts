import { type BinaryLike, type ScryptOptions, scrypt as _scrypt } from 'crypto';
import { Transform } from 'stream';
import { fmtMB } from '@/utils/data_processing/converter';

// ==========================
// Helpers internos
// ==========================
// esta clase controla el acceso concurrente a un recurso
// permite un número máximo de operaciones simultáneas
// y gestiona una cola de espera
// para controlar el acceso a un recurso compartido
// se usa para limitar el número de tareas de cifrado que se pueden ejecutar al mismo tiempo
export class Semaphore {
  private q: Array<() => void> = [];
  private slots: number;
  constructor(n: number) {
    this.slots = n;
  }
  async acquire() {
    if (this.slots > 0) {
      this.slots--;
      return () => this.release();
    }
    await new Promise<void>((r) => this.q.push(r));
    this.slots--;
    return () => this.release();
  }
  private release() {
    this.slots++;
    const n = this.q.shift();
    if (n) n();
  }
}

// Función para scrypt (derivación de clave)
// esta implementación utiliza promesas para facilitar su uso con async/await porque permite un manejo más sencillo de errores y evita el callback hell
export const scryptAsync = (password: BinaryLike, salt: BinaryLike, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    _scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });

// Tap transform stream para logging
// sirve para registrar el tamaño de los datos procesados
export function tap(label: string, stepBytes = 5 * 1024 * 1024) {
  let acc = 0;
  return new Transform({
    transform(chunk, _e, cb) {
      acc += chunk.length;
      if (acc >= stepBytes) {
        console.log(`[${label}] +${fmtMB(acc)}`);
        acc = 0;
      }
      cb(null, chunk);
    }
  });
}
