import { PassThrough, Readable, type Readable as NodeReadable } from 'node:stream';
import archiver from 'archiver';
import { HWM, ZIP_LOG_STEP } from '@/custom-types';
import { finished } from 'node:stream/promises';

// Empaquetador ZIP en streaming (SIN manifest)
export function createZipPackager() {
  const zipOut = new PassThrough({ highWaterMark: HWM });

  // level: 0 = "store" (no comprimir). Ciphertext no comprime = mejor throughput.
  const archive = archiver('zip', {
    zlib: { level: 0 },
    forceZip64: true // por si el ZIP supera 4GB (no molesta si es chico)
  });

  archive.on('warning', (err) => console.warn('[zip warning]', err));
  archive.on('error', (err) => {
    try {
      zipOut.destroy(err);
    } catch {}
  });

  archive.pipe(zipOut);

  /** Agrega una entrada al ZIP (no espera a que se consuma). */
  function appendEntry(name: string, content: NodeReadable | Buffer) {
    const nodeSrc = Buffer.isBuffer(content) ? Readable.from(content) : (content as NodeReadable);
    archive.append(nodeSrc, { name, store: true });
  }

  /**
   * Agrega una entrada y ESPERA a que el ZIP la consuma (backpressure-friendly).
   * Útil cuando quieres encadenar cifrado → ZIP sin inundar memoria.
   */
  async function appendEntryAwait(name: string, content: NodeReadable | Buffer) {
    const nodeSrc = Buffer.isBuffer(content) ? Readable.from(content) : (content as NodeReadable);
    const inlet = new PassThrough({ highWaterMark: HWM });
    const done = finished(inlet).catch(() => void 0); // resuelve cuando inlet terminó de recibir
    nodeSrc.pipe(inlet);
    archive.append(inlet, { name, store: true });
    await done;
  }

  /** Cierra el ZIP (Central Directory) y espera a que se emita todo. */
  async function finalize() {
    try {
      await archive.finalize(); // cierra el writer del ZIP
    } catch {
      // archiver puede lanzar si ya se finalizó/abortó; lo ignoramos
    }
    await finished(zipOut).catch(() => void 0); // espera al stream de salida
  }

  /** Aborta el ZIP y destruye el stream de salida. */
  function abort(err?: unknown) {
    try {
      archive.abort();
    } catch {}
    try {
      zipOut.destroy(err as any);
    } catch {}
  }

  return {
    stream: zipOut,
    appendEntry,
    appendEntryAwait,
    finalize,
    abort
  };
}
export function setupZipLogging(nodeZipStream: NodeJS.ReadableStream): void {
  let zipAccumulator = 0;

  nodeZipStream.on('data', (chunk: Buffer) => {
    zipAccumulator += chunk.length;
    if (zipAccumulator >= ZIP_LOG_STEP) {
      zipAccumulator = 0;
    }
  });

  nodeZipStream.on('error', (error) => console.error('[zip.node] error:', error));
}