// import type { PayloadRequest } from 'payload';
// import Busboy from 'busboy';
// import archiver from 'archiver';
// import { PassThrough, Readable, type Readable as NodeReadable } from 'node:stream';
// import { createInterface } from 'node:readline';
// import { pipeline, finished } from 'node:stream/promises';
// import { createCipheriv, randomBytes, scrypt as _scrypt, type BinaryLike, type ScryptOptions } from 'node:crypto';

// /**
//  * Handler V2: cifrado masivo por streaming + zip por streaming.
//  * - No rompe v1.
//  * - Optimiza RAM (chunked, backpressure).
//  * - Responde de inmediato y sigue trabajando mientras el cliente drena el ZIP.
//  */
// export async function massiveEncryptionHandler2(req: PayloadRequest): Promise<Response> {
//   // ==========================
//   // Config (puedes ajustar)
//   // ==========================
//   const HWM = 1024 * 1024; // 256 KiB para todos los PassThrough (buen throughput)
//   const CONCURRENCY = 4; // tareas de cifrado en paralelo (ajusta según CPU)
//   const SALT_LEN = 16; // 128-bit
//   const IV_LEN = 12; // 96-bit (recomendado para GCM)
//   const TAG_LEN = 16; // 128-bit
//   const KEY_LEN = 32; // 256-bits
//   const SCRYPT: ScryptOptions = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

//   // ==========================
//   // Tipos locales
//   // ==========================
//   type PasswordMap = Map<string, string>;
//   type FileEntryStream = {
//     fieldname: string;
//     filename: string;
//     mimetype: string;
//     stream: NodeReadable;
//     knownSize?: number | null;
//   };
//   type GcmMeta = { salt: Buffer; iv: Buffer; tag: Buffer; size: number };

//   // ==========================
//   // Helpers internos
//   // ==========================
//   const scryptAsync = (password: BinaryLike, salt: BinaryLike, keylen: number, opts: ScryptOptions) =>
//     new Promise<Buffer>((resolve, reject) => {
//       _scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
//     });

//   class Semaphore {
//     private count: number;
//     private queue: Array<() => void> = [];
//     constructor(private readonly max: number) {
//       this.count = max;
//     }
//     async acquire(): Promise<() => void> {
//       if (this.count > 0) {
//         this.count--;
//         return () => this.release();
//       }
//       await new Promise<void>((res) => this.queue.push(res));
//       this.count--;
//       return () => this.release();
//     }
//     private release() {
//       this.count++;
//       const next = this.queue.shift();
//       if (next) next();
//     }
//   }

//   // Normaliza nombres para buscar en el CSV (case-insensitive, sin BOM, sin rutas fake)
//   const normalizeFileName = (raw: string): string =>
//     raw
//       .replace(/^[A-Za-z]:\\fakepath\\|^\/?fakepath\/?/i, '') // quita C:\fakepath\ o /fakepath/
//       .split(/[\\/]/)
//       .pop()!
//       .replace(/^\uFEFF/, '') // quita BOM
//       .trim()
//       .normalize('NFC')
//       .toLowerCase();

//   // Convierte cabeceras (Headers o plain object) a objeto simple para Busboy
//   const toPlainHeaders = (h: any): Record<string, string> => {
//     try {
//       if (typeof h?.get === 'function' && typeof h?.entries === 'function') {
//         return Object.fromEntries(h.entries() as Iterable<[string, string]>);
//       }
//     } catch {}
//     return Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, String(v)]));
//   };

//   function monitorStream(label: string, s: NodeJS.ReadableStream) {
//     let acc = 0;
//     s.on('data', (c) => {
//       acc += c.length;
//       if (acc >= 5 * 1024 * 1024) {
//         console.log(`[${label}] procesados ${(acc / 1024 / 1024).toFixed(1)} MB`);
//         acc = 0;
//       }
//     });
//     s.on('end', () => console.log(`[${label}] terminado`));
//   }

//   // Parser de la solicitud multipart en streaming -> genera archivos + Map de passwords
//   async function getMassiveRequestStreams(request: PayloadRequest): Promise<{ files: AsyncGenerator<FileEntryStream, void, void>; passwords: PasswordMap; totalFiles: number }> {
//     const webBody: any = (request as any).body;
//     if (!webBody) throw new Error('empty_body');

//     const nodeBody: NodeReadable = typeof (Readable as any).fromWeb === 'function' ? (Readable as any).fromWeb(webBody) : (webBody as any);

//     const headers = toPlainHeaders(request.headers);
//     const busboy = Busboy({ headers });

//     const pwCsvChunks: Buffer[] = [];
//     const queue: Array<FileEntryStream | 'EOS'> = [];
//     let totalFiles = 0;

//     let wake!: () => void;
//     let wait = new Promise<void>((r) => (wake = r));

//     async function* filesGen() {
//       for (;;) {
//         while (queue.length === 0) await wait;
//         const item = queue.shift()!;
//         if (item === 'EOS') return;
//         yield item;
//         if (queue.length === 0) wait = new Promise<void>((r) => (wake = r));
//       }
//     }

//     // API moderna: (fieldname, fileStream, info)
//     busboy.on('file', (fieldname, file, info) => {
//       const filename: string = (info as any)?.filename ?? (info as any);
//       const mimeType: string = (info as any)?.mimeType ?? (info as any)?.mime ?? (info as any)?.mimetype ?? 'application/octet-stream';

//       if (!filename) {
//         file.resume();
//         return;
//       }
//       // const filenamex = info.filename || 'sin_nombre';
//       // let bytes = 0;

//       // file.on('data', (chunk: Buffer) => {
//       //   bytes += chunk.length;
//       //   console.log(`[${filenamex}] recibido chunk: ${chunk.length} bytes (total ${bytes})`);
//       // });

//       // file.on('end', () => {
//       //   console.log(`[${filename}] stream terminado (${bytes} bytes en total)`);
//       // });

//       // passwords.csv pequeño: OK juntar en RAM
//       if (fieldname === 'passwords' && filename.toLowerCase().endsWith('.csv')) {
//         file.on('data', (d: Buffer) => pwCsvChunks.push(d));
//         file.on('error', () => void 0);
//         return;
//       }
//       totalFiles++;
//       const tee = new PassThrough({ highWaterMark: HWM });
//       let acc = 0;
//       tee.on('data', (chunk) => {
//         acc += chunk.length;
//         if (acc > 5 * 1024 * 1024) {
//           // 5 MB
//           console.log(`[${filename}] +${(acc / 1024 / 1024).toFixed(1)} MB`);
//           acc = 0;
//         }
//       });

//       file.pipe(tee);

//       queue.push({
//         fieldname,
//         filename,
//         mimetype: mimeType,
//         stream: tee
//       });
//       wake();
//     });

//     const done = new Promise<void>((resolve, reject) => {
//       console.log('Esperando a que finalice la carga masiva...');
//       busboy.once('error', reject);
//       busboy.once('close', () => {
//         console.log('Carga masiva finalizada');
//         resolve();
//       });
//     });

//     nodeBody.pipe(busboy);
//     await done;

//     queue.push('EOS');
//     wake();

//     // Parse CSV (delimitador ';' o ','; salta encabezado)
//     async function parsePasswordsCsv(buf: Buffer): Promise<PasswordMap> {
//       const map: PasswordMap = new Map();
//       if (!buf?.length) return map;
//       const rl = createInterface({ input: Readable.from(buf.toString('utf8')) });
//       let isHeader = true;
//       for await (const line of rl) {
//         const l = line.trim();
//         if (!l) continue;
//         if (isHeader) {
//           isHeader = false; // asume primera línea como header
//           continue;
//         }
//         const [nameRaw, pw] = l.split(/[;,]/).map((s) => (s ?? '').trim());
//         if (!nameRaw) continue;
//         map.set(normalizeFileName(nameRaw), pw ?? '');
//       }
//       return map;
//     }

//     const passwords = await parsePasswordsCsv(Buffer.concat(pwCsvChunks));
//     return { files: filesGen(), passwords, totalFiles };
//   }

//   // Cifrado por streaming AES-256-GCM (no bloquea Event Loop; usa scrypt async)
//   function encryptStreamGCM(input: NodeReadable, password: string): { output: NodeReadable; metaPromise: Promise<GcmMeta> } {
//     const salt = randomBytes(SALT_LEN);
//     const iv = randomBytes(IV_LEN);
//     const out = new PassThrough({ highWaterMark: HWM });

//     const metaPromise = (async () => {
//       const key = await scryptAsync(password, salt, KEY_LEN, SCRYPT);
//       const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });

//       let size = 0;
//       cipher.on('data', (chunk) => {
//         size += chunk.length;
//       });

//       await pipeline(input, cipher, out); // respeta backpressure y propaga errores
//       const tag = cipher.getAuthTag();
//       return { salt, iv, tag, size };
//     })();

//     return { output: out, metaPromise };
//   }

//   // Empaquetador ZIP en streaming
//   function createZipPackager() {
//     const zipOut = new PassThrough({ highWaterMark: HWM });
//     const archive = archiver('zip', { zlib: { level: 0 } }); // ciphertext no comprime
//     archive.on('warning', (err) => console.warn('[zip warning]', err));
//     archive.on('error', (err) => zipOut.destroy(err));
//     archive.pipe(zipOut);

//     const manifest = new PassThrough({ highWaterMark: 16 * 1024 });
//     archive.append(manifest, { name: 'manifest.ndjson', store: true });

//     return {
//       stream: zipOut,
//       appendEntry(name: string, content: NodeReadable | Buffer) {
//         const nodeSrc = Buffer.isBuffer(content) ? Readable.from(content) : (content as NodeReadable);
//         // No bloqueamos esperando a que termine; archiver extrae cuando puede
//         archive.append(nodeSrc, { name, store: true });
//       },
//       appendManifestLine(line: string) {
//         manifest.write(line);
//         manifest.write('\n');
//       },
//       async finalize() {
//         manifest.end();
//         await archive.finalize();
//         await finished(zipOut).catch(() => void 0); // cerrar con gracia
//       }
//     };
//   }

//   function appendEntryAwait(name: string, readable: NodeJS.ReadableStream) {
//     const pt = new PassThrough();
//     const done = finished(pt); // se resuelve cuando el ZIP drenó todo lo que vino por pt
//     readable.pipe(pt);
//     zip.appendEntry(name, pt); // tu helper actual
//     return done;
//   }

//   // ==========================
//   // Lógica principal
//   // ==========================
//   const { files, passwords, totalFiles } = await getMassiveRequestStreams(req);

//   // 1) Crear ZIP y devolver de inmediato el stream al cliente
//   const zip = createZipPackager();
//   // Engancha logs del ZIP UNA sola vez y ANTES de procesar
//   zip.stream.on('data', (chunk) => {
//     console.log(`ZIP generando ${chunk.length} bytes...`);
//   });
//   zip.stream.on('end', () => {
//     console.log('ZIP finalizado');
//   });
//   zip.stream.on('error', (e) => {
//     console.error('ZIP error:', e);
//   });

//   // Convierte a WebStream y construye la Response
//   const webStream = typeof (Readable as any).toWeb === 'function' ? (Readable as any).toWeb(zip.stream) : (zip.stream as any);

//   const headers = new Headers({
//     'Content-Type': 'application/zip',
//     'Content-Disposition': 'attachment; filename="encrypted.zip"',
//     'Cache-Control': 'no-store'
//   });
//   const response = new Response(webStream as any, { headers });

//   // 2) Trabajo en “background” mientras el cliente drena el ZIP
//   (async () => {
//     const sem = new Semaphore(CONCURRENCY);
//     const tasks: Promise<void>[] = [];

//     for await (const f of files) {
//       console.log(`>> Empieza a procesar ${f.filename}`);
//       const key = normalizeFileName(f.filename);
//       const pw = passwords.get(key);

//       const t = (async () => {
//         const release = await sem.acquire();
//         try {
//           if (!pw) {
//             zip.appendManifestLine(JSON.stringify({ file_name: f.filename, error: 'missing_password' }));
//             f.stream.resume(); // drenar
//             return;
//           }

//           // Cifrado -> stream de salida
//           const { output, metaPromise } = encryptStreamGCM(f.stream, pw);

//           // Logs del cifrado (opcionales)
//           // output.on('data', (c) => console.log(`   [${f.filename}] cifrado chunk ${c.length}`));
//           // output.on('end', () => console.log(`   [${f.filename}] cifrado terminado`));
//           // Espera a que el ZIP CONSUME la entrada, no solo a cifrar
//           const entryDone = appendEntryAwait(`${f.filename}.enc`, output);

//           const meta = await metaPromise; // fin del cifrado
//           console.log('meta :', meta);
//           console.log('output', output);

//           console.log(`<< Terminó ${f.filename} (${meta.size} bytes)`);

//           // zip.appendManifestLine(
//           //   JSON.stringify({
//           //     file_name: f.filename,
//           //     size_bytes: meta.size,
//           //     salt_b64: meta.salt.toString('base64'),
//           //     iv_b64: meta.iv.toString('base64'),
//           //     tag_b64: meta.tag.toString('base64')
//           //   })
//           // );

//           await entryDone; // <- confirma que esa entrada quedó escrita en el ZIP
//         } finally {
//           release();
//         }
//       })();

//       tasks.push(t);
//     }

//     await Promise.all(tasks);
//     await zip.finalize(); // cierra el central directory del ZIP
//   })().catch((err) => {
//     // Propaga el error al stream del ZIP para que el cliente lo vea
//     console.error('Background error:', err);
//     zip.stream.destroy(err);
//   });

//   // 3) Devuelve YA la respuesta (streaming)
//   return response;
// }

// massiveEncryption2.ts
// Handler para PayloadCMS: recibe multipart, cifra cada archivo en streaming,
// y devuelve un ZIP también en streaming (sin esperar a terminar).

// massiveEncryption2.ts
// PayloadCMS handler: recibe multipart, cifra cada archivo (AES-256-GCM) y
// responde un ZIP en streaming mientras procesa. Con logs de progreso y resumen.

// massiveEncryption2.ts
// PayloadCMS handler: multipart → spool a disco → AES-256-GCM por archivo → ZIP en streaming
// con logs de progreso y limpieza de temporales.

// massiveEncryption2.ts
import type { PayloadRequest } from 'payload';
import Busboy from 'busboy';
import { Readable, PassThrough, Transform } from 'stream';
import { createInterface } from 'node:readline';
import { pipeline, finished as finishedStream } from 'stream/promises';
import { createCipheriv, randomBytes, scrypt as _scrypt } from 'crypto';
import { ZipFile } from 'yazl';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCRYPT } from '@/custom-types';

/* ============================== CONST ============================== */
const CONCURRENCY = 8;
const HWM = 1024 * 1024;
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const ZIP_LOG_STEP = 5 * 1024 * 1024;

/* ============================== TYPES ============================== */
type NodeReadable = NodeJS.ReadableStream;
type FileEntryStream = { fieldname: string; filename: string; mimetype: string; stream: NodeReadable; tmpPath?: string };
type PasswordMap = Map<string, string>;
type FileStatus = { file: string; status: 'ok'; size: number } | { file: string; status: 'missing_password' } | { file: string; status: 'error'; message: string };

/* ============================== UTILS ============================== */
const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
const normalizeFileName = (s: string) =>
  String(s ?? '')
    .trim()
    .toLowerCase();
function toPlainHeaders(h: any) {
  const out: Record<string, any> = {};
  if (h && typeof h.forEach === 'function') (h as Headers).forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (h && typeof h === 'object') for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  return out;
}
class Semaphore {
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
function tap(label: string, stepBytes = 5 * 1024 * 1024) {
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

/* ============================== ZIP (sin manifest) ============================== */
function createZipPackager() {
  const zip = new ZipFile();
  const output = zip.outputStream; // Node Readable del ZIP

  function appendEntry(name: string, readable: NodeReadable) {
    zip.addReadStream(readable, name);
  }

  async function appendEntryAwait(name: string, readable: NodeReadable) {
    const inlet = new PassThrough({ highWaterMark: HWM });
    const done = finishedStream(inlet);
    readable.pipe(inlet);
    appendEntry(name, inlet);
    await done;
  }

  async function finalize() {
    zip.end(); // cierra Central Directory
    await finishedStream(output);
  }

  function abort(err?: unknown) {
    try {
      (output as any)?.destroy?.(err as any);
    } catch {}
    try {
      (output as any)?.cancel?.(err as any);
    } catch {}
    try {
      zip.end();
    } catch {}
  }

  return { stream: output, appendEntry, appendEntryAwait, finalize, abort };
}

/* ============================== Cifrado ============================== */
const scryptAsync = (password: Buffer | string, salt: Buffer, keylen: number, opts: any) =>
  new Promise<Buffer>((res, rej) => _scrypt(password, salt, keylen, opts, (e, k) => (e ? rej(e) : res(k as Buffer))));

function encryptStreamGCM(input: NodeJS.ReadableStream, password: string) {
  const salt = randomBytes(SALT_LEN);
  const iv   = randomBytes(IV_LEN);

  let size = 0;
  const count = new Transform({
    transform(chunk, _enc, cb) { size += chunk.length; cb(null, chunk); }
  });

  // salida cifrada “framed”: [salt][iv] + ciphertext… + [tag]
  const out = new PassThrough({ highWaterMark: HWM });

  const metaPromise = (async () => {
    const key    = await scryptAsync(password, salt, KEY_LEN, SCRYPT);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });

    // 1) header: salt + iv
    out.write(salt);
    out.write(iv);

    // 2) conectar cipher → out SIN cerrar out
    cipher.pipe(out, { end: false });

    // 3) pipeline de entrada hasta el cipher (respeta backpressure)
    await pipeline(input, count, cipher);

    // 4) trailer: tag al final y cerrar
    const tag = cipher.getAuthTag();
    out.end(tag);

    return { size, salt, iv, tag };
  })();

  return { output: out, metaPromise };
}


/* ============================== Multipart (spool a disco + EOS correcto) ============================== */
async function getMassiveRequestStreams(request: PayloadRequest): Promise<{ files: AsyncGenerator<FileEntryStream, void, void>; passwords: PasswordMap; totalFiles: number }> {
  const maybeWebBody: any = (request as any).body ?? null;
  const nodeBody: NodeReadable = typeof (Readable as any).fromWeb === 'function' && maybeWebBody?.getReader ? (Readable as any).fromWeb(maybeWebBody) : (request as any);

  const headers = toPlainHeaders(request.headers);
  const busboy = Busboy({ headers });

  const pwCsvChunks: Buffer[] = [];
  const queue: Array<FileEntryStream | 'EOS'> = [];
  const spoolPromises: Promise<void>[] = [];
  let totalFiles = 0;

  let wake!: () => void;
  let wait = new Promise<void>((r) => (wake = r));

  async function* filesGen() {
    for (;;) {
      while (queue.length === 0) await wait;
      const item = queue.shift()!;
      if (item === 'EOS') return;
      yield item;
      if (queue.length === 0) wait = new Promise<void>((r) => (wake = r));
    }
  }

  busboy.on('file', (fieldname, file, info) => {
    const filename: string = (info as any)?.filename ?? (info as any);
    const mimeType: string = (info as any)?.mimeType ?? (info as any)?.mime ?? (info as any)?.mimetype ?? 'application/octet-stream';
    if (!filename) {
      file.resume();
      return;
    }

    // passwords.csv
    if (fieldname === 'passwords' && filename.toLowerCase().endsWith('.csv')) {
      file.on('data', (d: Buffer) => pwCsvChunks.push(d));
      file.on('error', () => void 0);
      return;
    }

    totalFiles++;

    // spool a disco
    const tmpDir = path.join(os.tmpdir(), 'payload-encrypt');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
    const ws = fs.createWriteStream(tmpPath, { highWaterMark: HWM });

    // progreso de subida
    let acc = 0;
    file.on('data', (chunk) => {
      acc += chunk.length;
      if (acc >= 5 * 1024 * 1024) {
        console.log(`[upload ${filename}] +${fmtMB(acc)} hacia disco`);
        acc = 0;
      }
    });

    file.pipe(ws);

    const spoolOnce = new Promise<void>((resolve) => {
      ws.once('finish', () => {
        console.log(`→ Spool OK: ${filename} → ${tmpPath}`);
        queue.push({ fieldname, filename, mimetype: mimeType, stream: fs.createReadStream(tmpPath, { highWaterMark: HWM }), tmpPath });
        wake();
        resolve();
      });
      ws.once('error', (err) => {
        console.error('Error spooling a disco:', err);
        try {
          file.resume();
        } catch {}
        resolve();
      });
    });
    spoolPromises.push(spoolOnce);
  });

  const done = new Promise<void>((resolve, reject) => {
    console.log('Esperando a que finalice la carga masiva...');
    busboy.once('error', reject);
    busboy.once('close', async () => {
      console.log('Carga masiva finalizada (busboy cerrado)');
      await Promise.allSettled(spoolPromises);
      console.log(`Spooling completado (${spoolPromises.length}/${totalFiles})`);
      resolve();
    });
  });

  nodeBody.pipe(busboy);
  await done;

  queue.push('EOS');
  wake();

  // passwords
  async function parsePasswordsCsv(buf: Buffer): Promise<PasswordMap> {
    const map: PasswordMap = new Map();
    if (!buf?.length) return map;
    const rl = createInterface({ input: Readable.from(buf.toString('utf8')) });
    let isHeader = true;
    for await (const line of rl) {
      const l = line.trim();
      if (!l) continue;
      if (isHeader) {
        isHeader = false;
        continue;
      }
      const [nameRaw, pw] = l.split(/[;,]/).map((s) => (s ?? '').trim());
      if (!nameRaw) continue;
      map.set(normalizeFileName(nameRaw), pw ?? '');
    }
    return map;
  }

  const passwords = await parsePasswordsCsv(Buffer.concat(pwCsvChunks));
  return { files: filesGen(), passwords, totalFiles };
}

/* ============================== Web Readable con logs ============================== */
function makeWebZipStream(nodeZipStream: NodeJS.ReadableStream) {
  let total = 0,
    chunks = 0,
    lastTs = Date.now();
  let timer: NodeJS.Timeout | null = null;

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      console.log('[webStream] start');
      nodeZipStream.on('data', (buf: Buffer) => {
        const u8 = new Uint8Array(buf);
        controller.enqueue(u8);
        total += u8.byteLength;
        chunks++;
        lastTs = Date.now();
        if (total >= ZIP_LOG_STEP || chunks % 16 === 0) {
          console.log(`[webStream] enqueue: chunk=${u8.byteLength}B, total=${fmtMB(total)}, desiredSize=${controller.desiredSize}`);
        }
        if (controller.desiredSize !== null && controller.desiredSize <= 0) console.log('[webStream] backpressure');
      });
      nodeZipStream.once('end', () => {
        console.log('[webStream] end -> close');
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

/* ============================== Handler (Fetch) ============================== */
export async function massiveEncryptionHandler2(req: PayloadRequest): Promise<Response> {
  console.time('⏱️ massive-encrypt');
  console.log('[handler] inicio');

  const { files, passwords, totalFiles } = await getMassiveRequestStreams(req);
  console.log('[handler] archivos a procesar:', totalFiles);

  const zip = createZipPackager();
  const nodeZipStream = zip.stream as unknown as NodeJS.ReadableStream;

  // logs del ZIP (Node)
  let zipAcc = 0;
  nodeZipStream.on('data', (chunk: Buffer) => {
    zipAcc += chunk.length;
    if (zipAcc >= ZIP_LOG_STEP) {
      console.log(`[zip.node] +${fmtMB(zipAcc)} acumulados`);
      zipAcc = 0;
    }
  });
  nodeZipStream.on('end', () => console.log('[zip.node] end'));
  nodeZipStream.on('error', (e) => console.error('[zip.node] error:', e));

  const { webStream, stop } = makeWebZipStream(nodeZipStream);

  // Worker: cifra y agrega entradas al ZIP (sin manifest)
  (async () => {
    const sem = new Semaphore(CONCURRENCY);
    const tasks: Promise<void>[] = [];
    const status: FileStatus[] = [];
    let started = 0,
      finished = 0,
      ok = 0,
      missingPw = 0,
      failed = 0;

    for await (const f of files) {
      started++;
      console.log(`[worker] start ${f.filename} (${started}/${totalFiles})`);
      const key = normalizeFileName(f.filename);
      const pw = passwords.get(key);

      const t = (async () => {
        const release = await sem.acquire();
        try {
          if (!pw) {
            missingPw++;
            status.push({ file: f.filename, status: 'missing_password' });
            console.log(`[worker] missing_password ${f.filename}`);
            f.stream.resume();
            return;
          }

          const tappedSrc = f.stream.pipe(tap(`src ${f.filename}`, 1 * 1024 * 1024));
          const { output, metaPromise } = encryptStreamGCM(tappedSrc, pw);
          const tappedOut = output.pipe(tap(`enc ${f.filename}`, 1 * 1024 * 1024));

          const entryDone = zip.appendEntryAwait(`${f.filename}.enc`, tappedOut);

          const meta = await metaPromise;
          await entryDone;

          ok++;
          status.push({ file: f.filename, status: 'ok', size: meta.size });
          console.log(`[worker] OK ${f.filename} (${fmtMB(meta.size)}) [ok:${ok} missing:${missingPw} fail:${failed}]`);
        } catch (e: any) {
          failed++;
          status.push({ file: f.filename, status: 'error', message: e?.message ?? String(e) });
          console.error(`[worker] ERROR ${f.filename}:`, e);
          try {
            f.stream.resume();
          } catch {}
        } finally {
          if (f.tmpPath) {
            try {
              await fs.promises.unlink(f.tmpPath);
            } catch {}
          }
          finished++;
          console.log(`[worker] progreso: ${finished}/${totalFiles}`);
          release();
        }
      })();

      tasks.push(t);
    }

    try {
      await Promise.all(tasks);
      console.log('[worker] todos procesados, finalizando ZIP…');
      await zip.finalize();
      console.log(`[worker] ✅ ZIP finalizado. ok:${ok}, missingPw:${missingPw}, failed:${failed}`);
      console.dir(status, { depth: 1 });
    } catch (err) {
      console.error('[worker] error finalize/tasks:', err);
      try {
        (nodeZipStream as any)?.destroy?.(err);
      } catch {}
      try {
        zip.abort(err);
      } catch {}
    } finally {
      console.timeEnd('⏱️ massive-encrypt');
      stop();
    }
  })().catch((err) => {
    console.error('[worker] outer catch:', err);
    try {
      (nodeZipStream as any)?.destroy?.(err);
    } catch {}
    try {
      zip.abort(err);
    } catch {}
    console.timeEnd('⏱️ massive-encrypt');
    stop();
  });

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="encrypted.zip"',
    'Cache-Control': 'no-store'
  });
  console.log('[handler] creando Response (Fetch)');
  const response = new Response(webStream, { headers });
  console.log('[handler] Response creada y retornada');
  return response;
}
