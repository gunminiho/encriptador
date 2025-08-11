import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Readable as NodeReadable } from 'node:stream';
import type { BinaryInput } from '@/custom-types';

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

/**
 * Convierte bytes a megabytes (base binaria, 1 MB = 1 048 576 bytes).
 * @param req  PayloadRequest.
 * @returns  Retorna un tipo NodeReadable.
 */
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

/**
 * Convierte bytes a megabytes (base binaria, 1 MB = 1 048 576 bytes).
 * @param data  Recibe un tipo BinaryInput.
 * @returns  Retorna un tipo ArrayBuffer.
 */
export const toArrayBuffer = (data: BinaryInput): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data;

  const u8 = data as Uint8Array; // Buffer también cae aquí
  // Si ya es un ArrayBuffer “puro” y alineado, úsalo; si no, copia
  if (u8.buffer instanceof ArrayBuffer && u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
    return u8.buffer;
  }
  // Copia segura → garantiza ArrayBuffer (no SharedArrayBuffer)
  return u8.slice().buffer;
};

/**
 * Convierte bytes a megabytes (base binaria, 1 MB = 1 048 576 bytes).
 * @param e  Recibe tipo de error desconocido.
 * @returns  Retorna un tipo Error específico.
 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  try {
    return new Error(typeof e === 'string' ? e : JSON.stringify(e));
  } catch {
    return new Error('Unknown error');
  }
}
