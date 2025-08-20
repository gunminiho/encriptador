import { PassThrough, Transform } from 'node:stream';
import { HWM, NodeReadable } from '@/custom-types';

export function sanitizePassword(s: string | undefined): string {
  const t = String(s ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).trim();
  return t;
}

export async function readExactlyHeader(input: NodeReadable, headerLen: number): Promise<{ header: Buffer; rest: NodeReadable }> {
  const rest = new PassThrough({ highWaterMark: HWM });
  const chunks: Buffer[] = [];
  let got = 0;

  return await new Promise((resolve, reject) => {
    function onData(chunk: Buffer) {
      if (got < headerLen) {
        const need = headerLen - got;
        if (chunk.length <= need) {
          chunks.push(chunk);
          got += chunk.length;
          if (got < headerLen) return;
          input.off('data', onData);
          input.pipe(rest);
          resolve({ header: Buffer.concat(chunks), rest });
        } else {
          chunks.push(chunk.subarray(0, need));
          const remain = chunk.subarray(need);
          input.off('data', onData);
          rest.write(remain);
          input.pipe(rest);
          resolve({ header: Buffer.concat(chunks), rest });
        }
      } else {
        rest.write(chunk);
      }
    }
    function onEnd() {
      reject(new Error('enc_too_short_header'));
    }
    function onErr(e: any) {
      reject(e);
    }
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onErr);
  });
}

export class HoldbackTransform extends Transform {
  private tail: Buffer = Buffer.alloc(0);
  constructor(private holdBytes: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    const buf = this.tail.length ? Buffer.concat([this.tail, chunk]) : chunk;
    if (buf.length <= this.holdBytes) {
      this.tail = buf;
      cb();
      return;
    }
    const emitLen = buf.length - this.holdBytes;
    this.tail = buf.subarray(emitLen);
    this.push(buf.subarray(0, emitLen));
    cb();
  }
  _flush(cb: (err?: Error | null) => void) {
    this.emit('trailer', this.tail);
    this.tail = Buffer.alloc(0);
    cb();
  }
}
