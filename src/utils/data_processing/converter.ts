import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Readable as NodeReadable } from 'node:stream';

/**
 * Convierte bytes a megabytes (base binaria, 1 MB = 1 048 576 bytes).
 * @param bytes  Número de bytes.
 * @param decimals  Decimales a mostrar (default 2).
 * @returns  Megabytes como número con la cantidad de decimales indicada.
 */
export function bytesToMB(bytes: number, decimals = 4): number {
  const BYTES_IN_MB = 1024 ** 2;
  return Number((bytes / BYTES_IN_MB).toFixed(decimals));
}

export function toNodeReadable(req: unknown): NodeReadable {
  const r: any = req;
  if (typeof r.pipe === 'function') {
    // Request estilo Express/IncomingMessage
    return r as NodeReadable;
  }
  if (r?.body && typeof r.body.getReader === 'function') {
    // Request estilo Fetch con Web ReadableStream
    const webBody = r.body as WebReadableStream<Uint8Array>;
    // 👇 notar el tipo importado de 'node:stream/web'
    return Readable.fromWeb(webBody); // también podrías: Readable.fromWeb<Uint8Array>(webBody)
  }
  throw new Error('UNSUPPORTED_REQUEST_TYPE');
}
