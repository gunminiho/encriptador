import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Readable as NodeReadable } from 'node:stream';
import { type BinaryInput, ZIP_LOG_STEP } from '@/custom-types';

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
 * @param n  Número de bytes.
 * @returns  Megabytes como número.
 */
// Formatea un número en megabytes (base binaria, 1 MB = 1 048 576 bytes).
export const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';

/**
 * Convierte un stream legible por la web a un stream legible por Node.js.
 * @param req  request 
 * @returns  Stream legible por Node.js.
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

/**
 * Normaliza nombres de archivos.
 * @param raw  Nombre del archivo sin rutas fake.
 * @returns  Nombre del archivo normalizado.
 */
// Normaliza nombres para buscar en el CSV (case-insensitive, sin BOM, sin rutas fake)
export const normalizeFileName = (raw: string): string =>
  raw
    .replace(/^[A-Za-z]:\\fakepath\\|^\/?fakepath\/?/i, '') // quita C:\fakepath\ o /fakepath/
    .split(/[\\/]/)
    .pop()!
    .replace(/^\uFEFF/, '') // quita BOM
    .trim()
    .normalize('NFC')
    .toLowerCase();

/**
 * Normaliza nombres de archivos.
 * @param h  Cabeceras (Headers o plain object).
 * @returns  Nombre del archivo normalizado.
 */
// Convierte cabeceras (Headers o plain object) a objeto simple para Busboy
export const toPlainHeaders = (h: any): Record<string, string> => {
  try {
    if (typeof h?.get === 'function' && typeof h?.entries === 'function') {
      return Object.fromEntries(h.entries() as Iterable<[string, string]>);
    }
  } catch {}
  return Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, String(v)]));
};

/**
 * Convierte un stream legible por Node.js a un stream legible por la web.
 * @param nodeZipStream  Stream legible por Node.js.
 * @returns  Stream legible por la web.
 */
// Convierte cabeceras (Headers o plain object) a objeto simple para Busboy
/* ============================== Web Readable con logs ============================== */
export function makeWebZipStream(nodeZipStream: NodeJS.ReadableStream) {
  let total = 0,
    chunks = 0,
    lastTs = Date.now();
  let timer: NodeJS.Timeout | null = null;

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      //console.log('[webStream] start');
      nodeZipStream.on('data', (buf: Buffer) => {
        const u8 = new Uint8Array(buf);
        controller.enqueue(u8);
        total += u8.byteLength;
        chunks++;
        lastTs = Date.now();
        if (total >= ZIP_LOG_STEP || chunks % 16 === 0) {
          //console.log(`[webStream] enqueue: chunk=${u8.byteLength}B, total=${fmtMB(total)}, desiredSize=${controller.desiredSize}`);
        }
        //if (controller.desiredSize !== null && controller.desiredSize <= 0) console.log('[webStream] backpressure');
      });
      nodeZipStream.once('end', () => {
        //console.log('[webStream] end -> close');
        controller.close();
      });
      nodeZipStream.once('error', (e) => {
        console.error('[webStream] error -> controller.error', e);
        controller.error(e);
      });
      timer = setInterval(() => {
        console.log(`[webStream] hb: total=${fmtMB(total)}, chunks=${chunks}, idle=${((Date.now() - lastTs) / 1000).toFixed(1)}s, desired=${controller.desiredSize}`);
      }, 2000);
    },
    cancel(reason) {
      console.warn('[webStream] cancel', reason);
      try {
        (nodeZipStream as any)?.destroy?.(reason);
      } catch {}
    }
  });

  return { webStream, stop: () => timer && clearInterval(timer) };
}

export const removeEncExt = (name: string) => name.replace(/\.enc$/i, '') || name;
