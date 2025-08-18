import { PayloadRequest, addDataAndFileToRequest } from 'payload';
import Busboy from 'busboy';
import { toNodeReadable, toPlainHeaders } from '../data_processing/converter';
import { sanitizePassword } from '../data_processing/validator';
import type { PayloadFileRequest, MassiveEncryptionRequest, SingleEncryptionRequest, FileEntryStream, PasswordMap, ParsedSingle } from '@/custom-types';
import { HWM } from '@/custom-types';
import { isAllowedFile } from '../data_processing/fileChecker';
import { PassThrough, Readable, type Readable as NodeReadable } from 'node:stream';
import { parsePasswordsCsv } from '@/utils/data_processing/csvParser';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const getRequestData = async (req: PayloadRequest, errors: Array<string>): Promise<MassiveEncryptionRequest> => {
  try {
    //Multipart → files + CSV
    await addDataAndFileToRequest(req);
    //Get the files and CSV from the request
    const allFiles = Array.isArray(req.file) ? req.file : [req.file].filter(Boolean);
    const csvFile = allFiles.find((f) => f.name === 'passwords.csv');
    const dataFiles = allFiles.filter((f) => f.name !== 'passwords.csv');
    if (!csvFile) errors.push('No se encontró passwords.csv');

    return { csvFile, dataFiles };
  } catch (error: unknown) {
    console.error('Hubo un error para esta petición al extraer los archivos desde formData: ' + (error as Error).message);
    throw new Error('Hubo un error para esta petición al extraer los archivos desde formData: ' + (error as Error).message);
  }
};

export const getSingleRequestData = async (req: PayloadRequest): Promise<SingleEncryptionRequest> => {
  // 1) content-type robusto
  const ct =
    typeof (req as any).headers.get === 'function'
      ? ((req as any).headers.get('content-type') as string | undefined)
      : ((req.headers as any).get['content-type'] as string | undefined);

  if (!ct || !ct.startsWith('multipart/form-data')) {
    throw new Error(`INVALID_CONTENT_TYPE_HEADER: ${ct ?? 'undefined'}`);
  }

  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: { 'content-type': ct },
      limits: { files: 1, fileSize: 500 * 1024 * 1024 } // Tamaño definido en .env
    });

    let password: string = '';
    let file_req: PayloadFileRequest = {
      clientUploadContext: undefined,
      data: Buffer.alloc(0),
      mimetype: '',
      name: '',
      size: 0,
      tempFilePath: undefined,
      fieldName: undefined
    };

    bb.on('field', (name, val) => {
      if (name === 'password') password = val;
    });

    bb.on('file', (name, file, info) => {
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => chunks.push(d));
      file.on('limit', () => reject(new Error('El archivo excede el tamaño permitido: ' + process.env.FILE_SIZE_LIMIT + 'MB')));
      file.on('end', () => {
        const data = Buffer.concat(chunks);
        file_req = {
          fieldName: name,
          name: info.filename,
          mimetype: info.mimeType,
          size: data.length,
          data
        };
      });
    });

    bb.on('close', () => {
      resolve({ file: file_req, password });
    });

    bb.on('error', reject);

    // 2) Conectar el stream según el tipo de request
    toNodeReadable(req).pipe(bb);
  });
};

/* ============================== Multipart (spool a disco + EOS correcto) ============================== */
// Parser de la solicitud multipart en streaming -> genera archivos + Map de passwords
// Cifrado por streaming AES-256-GCM (no bloquea Event Loop; usa scrypt async)
export async function getMassiveRequestStreams(
  request: PayloadRequest
): Promise<{ files: AsyncGenerator<FileEntryStream, void, void>; passwords: PasswordMap; totalFiles: number }> {
  const maybeWebBody: any = (request as any).body ?? null;
  const nodeBody: NodeReadable = typeof (Readable as any).fromWeb === 'function' && maybeWebBody?.getReader ? (Readable as any).fromWeb(maybeWebBody) : (request as any);

  const headers = toPlainHeaders(request.headers);
  console.log('headers:', headers);
  console.log('req.headers', request.headers);

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
        //console.log(`[upload ${filename}] +${fmtMB(acc)} hacia disco`);
        acc = 0;
      }
    });

    file.pipe(ws);

    const spoolOnce = new Promise<void>((resolve) => {
      ws.once('finish', () => {
        //console.log(`→ Spool OK: ${filename} → ${tmpPath}`);
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
    //console.log('Esperando a que finalice la carga masiva...');
    busboy.once('error', reject);
    busboy.once('close', async () => {
      //console.log('Carga masiva finalizada (busboy cerrado)');
      await Promise.allSettled(spoolPromises);
      //console.log(`Spooling completado (${spoolPromises.length}/${totalFiles})`);
      resolve();
    });
  });

  nodeBody.pipe(busboy);
  await done;

  queue.push('EOS');
  wake();

  const passwords = await parsePasswordsCsv(Buffer.concat(pwCsvChunks));
  return { files: filesGen(), passwords, totalFiles };
}

/* ========== Parser SINGLE streaming (file + password) ========== */
export async function getSingleStreamFromBusboy(req: PayloadRequest): Promise<ParsedSingle> {
  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);
  const bb = Busboy({ headers, limits: { files: 1, fields: 6 } });

  let filename = 'file.enc';
  let mimetype = 'application/octet-stream';
  let password = '';
  let streamResolved = false;
  console.log('procesamiento del archivo...');

  const tee = new PassThrough({ highWaterMark: HWM });

  const done = new Promise<void>((resolve, reject) => {
    bb.on('field', (name, val) => {
      if (name === 'password') password = sanitizePassword(val);
      console.log('Campo recibido:', name, val);
    });

    bb.on('file', (_field, file, info) => {
      if (streamResolved) {
        file.resume(); // ignora archivos extra
        return;
      }

      filename = info.filename ?? filename;
      mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;
      console.log('Archivo recibido:', info.filename);
      console.log('MIME type:', mimetype);

      file.pipe(tee);
      streamResolved = true;
      console.log('Stream resuelto:', info.filename, streamResolved);
    });

    bb.once('error', () => {
      console.error('Error procesando el archivo:', filename);
      reject();
    });
    bb.once('finish', () => {
      console.log('Finalizando el procesamiento de la solicitud...');
      resolve();
    });
  });

  body.pipe(bb);
  await done;

  if (!streamResolved) throw new Error('missing_file_part');
  if (!password) throw new Error('missing_password');

  return { filename, mimetype, stream: tee, password };
}

type Options = {
  fieldName?: string; // default: 'file'
  sniffBytes?: number; // bytes para pasar a isAllowedFile (default 4096)
  maxMB?: number; // default: process.env.FILE_SIZE_LIMIT || 50
};

export async function parseSingleWithValidation(req: PayloadRequest, errors: string[], opts: Options = {}): Promise<ParsedSingle | null> {
  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);

  const fieldName = opts.fieldName ?? 'file';
  const sniffBytes = opts.sniffBytes ?? 512;
  const maxMB = Number(opts.maxMB ?? process.env.FILE_SIZE_LIMIT ?? 500);
  const maxBytes = maxMB * 1024 * 1024;

  const bb = Busboy({ headers, limits: { files: 1, fields: 6, fileSize: maxBytes } });

  let filename = 'file';
  let mimetype = 'application/octet-stream';
  let sawFile = false;
  let sawPassword = false;
  let password: string = '';

  const tee = new PassThrough({ highWaterMark: HWM });

  const done = new Promise<void>((resolve, reject) => {
    bb.on('field', (name, val) => {
      if (name === 'password') {
        sawPassword = true;
        password = val;
      }
    });

    bb.on('file', (name, file, info) => {
      if (name !== fieldName) return file.resume();
      if (sawFile) return file.resume();
      sawFile = true;

      filename = info.filename ?? filename;
      mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;

      file.once('limit', () => {
        errors.push(`El archivo excede el tamaño máximo permitido de ${maxMB}MB`);
        // Cancela TODA escritura/escucha pendiente
        safeAbort('file_limit');
      });

      let sniff = Buffer.alloc(0);
      let validated = false;
      let rejected = false;

      // utilidades para cancelar seguro
      const safeAbort = (reason: string, err?: Error) => {
        rejected = true;
        try {
          file.removeAllListeners('data');
        } catch {}
        try {
          file.pause();
        } catch {}
        try {
          file.unpipe();
        } catch {}
        try {
          if (!tee.destroyed) tee.destroy(err ?? new Error(reason));
        } catch {}
        try {
          file.resume();
        } catch {}
      };

      file.on('data', async (chunk: Buffer) => {
        if (rejected) return;

        // arma sniff (una sola vez)
        if (!validated) {
          const need = Math.max(0, sniffBytes - sniff.length);
          if (need > 0) sniff = Buffer.concat([sniff, chunk.subarray(0, need)]);
          // valida solo una vez cuando ya juntaste suficiente o se acabó el primer chunk
          if (sniff.length >= Math.min(sniffBytes, chunk.length) && !validated) {
            validated = true;
            try {
              const { allowed, extension } = await isAllowedFile(sniff, filename);
              if (!allowed) {
                errors.push(`archivo (.${extension || path.extname(filename).slice(1).toLowerCase() || 'unknown'}) no esta permitido`);
                return safeAbort('file_type_not_allowed');
              }
            } catch (e: any) {
              errors.push(e?.message ?? 'validacion_fallida');
              return safeAbort('validation_error', e instanceof Error ? e : undefined);
            }
          }
        }

        // si ya fue rechazado o el tee terminó, no escribas
        if (rejected || tee.destroyed || (tee as any).writableEnded) return;

        // forward respetando backpressure (con guardas)
        if (!tee.write(chunk)) {
          file.pause();
          tee.once('drain', () => {
            if (!rejected && !tee.destroyed && !(tee as any).writableEnded) file.resume();
          });
        }
      });

      file.on('end', () => {
        if (!rejected && !tee.destroyed && !(tee as any).writableEnded) {
          try {
            tee.end();
          } catch {}
        }
      });
    });

    bb.once('error', reject);
    bb.once('finish', resolve);
  });

  body.pipe(bb);
  await done;

  // (1) existencia de campos
  if (!sawFile) errors.push('No se encontró el archivo en la petición');
  if (!sawPassword) errors.push('No se encontró la contraseña en la petición');

  // (4) contraseña debe ser string
  if (sawPassword && typeof password !== 'string') {
    errors.push('La contraseña debe ser un string');
  }

  // (3) longitud mínima 1
  const pwd = sanitizePassword(password);
  if (sawPassword && typeof password === 'string' && pwd.length < 1) {
    errors.push('La contraseña debe tener al menos 1 carácter');
  }

  if (errors.length > 0) {
    try {
      tee.destroy();
    } catch {}
    return null;
  }

  return {
    filename,
    mimetype,
    stream: tee,
    password: pwd
  };
}

export async function parseSingleWithValidationEarly(
  req: PayloadRequest,
  errors: string[],
  opts?: { sniffBytes?: number; maxMB?: number; fieldName?: string }
): Promise<ParsedSingle | null> {
  const sniffBytes = opts?.sniffBytes ?? 512;
  const maxMB = opts?.maxMB ?? Number(process.env.FILE_SIZE_LIMIT ?? 1024);
  const fieldName = opts?.fieldName ?? 'file';

  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);
  const bb = Busboy({ headers, limits: { fields: 8 } });

  let password = '';
  let filename = 'file';
  let mimetype = 'application/octet-stream';
  let resolved = false;
  let sawFile = false;

  // Creamos el tee ya, pero OJO: lo vamos a pipear cuando llegue file
  const tee = new PassThrough({ highWaterMark: HWM });

  // esto sirve para resolver la promesa una sola vez y se usa en el evento 'finish' de busboy y lo llamo pasandole los parametros
  const resolveOnce = (val: ParsedSingle | null, endBusboy = false, err?: Error) => {
    if (resolved) return;
    resolved = true;
    if (val) resolver(val);
    else resolver(null);
    if (endBusboy) {
      try {
        bb.removeAllListeners();
      } catch {}
      try {
        (body as any)?.unpipe?.(bb);
      } catch {}
      try {
        (body as any)?.resume?.();
      } catch {}
      try {
        tee.destroy(err);
      } catch {}
    }
  };

  const resolver = (() => {
    let _res!: (v: ParsedSingle | null) => void;
    const p = new Promise<ParsedSingle | null>((r) => (_res = r));
    (p as any)._resolve = _res;
    return (v: ParsedSingle | null) => _res(v);
  })() as unknown as (v: ParsedSingle | null) => void;

  const parsedPromise = new Promise<ParsedSingle | null>((resolve) => {
    // fields
    bb.on('field', (name, val) => {
      if (name === 'password') {
        //console.log('detecte campo password');
        if (typeof val !== 'string') errors.push('La contraseña debe ser un string');
        password = sanitizePassword(val);
        if (password.length < 1) errors.push('La contraseña debe tener al menos 1 carácter', password);
        //console.log('password:', password);
      }
    });

    // file
    bb.on('file', async (name, file, info) => {
      if (name !== fieldName || sawFile) {
        file.resume();
        return;
      }
      sawFile = true;
      console.log('file',file);
      console.log('info', info);

      filename = info.filename ?? filename;
      mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;

      // límite por tamaño
      file.once('limit', () => {
        errors.push(`El archivo excede el tamaño máximo permitido de ${maxMB}MB`);
        safeAbort('file_limit');
      });

      // validación por sniff (una sola vez)
      let sniff = Buffer.alloc(0);
      let validated = false;
      let rejected = false;

      const safeAbort = (reason: string, err?: Error) => {
        rejected = true;
        try {
          file.removeAllListeners('data');
        } catch {}
        try {
          file.pause();
        } catch {}
        try {
          file.unpipe();
        } catch {}
        try {
          tee.destroy(err ?? new Error(reason));
        } catch {}
        try {
          file.resume();
        } catch {}
        // no resolvemos aquí; dejamos que termine busboy y más abajo resolvemos con null si corresponde
      };

      file.on('data', async (chunk: Buffer) => {
        if (rejected) return;

        if (!validated) {
          const need = Math.max(0, sniffBytes - sniff.length);
          if (need > 0) sniff = Buffer.concat([sniff, chunk.subarray(0, need)]);
          if (sniff.length >= Math.min(sniffBytes, chunk.length) && !validated) {
            validated = true;
            try {
              const { allowed, extension } = await isAllowedFile(sniff, filename);
              if (!allowed) {
                errors.push(`archivo (.${extension || path.extname(filename).slice(1).toLowerCase() || 'unknown'}) no esta permitido`);
                return safeAbort('file_type_not_allowed');
              }
            } catch (e: any) {
              errors.push(e?.message ?? 'validacion_fallida');
              return safeAbort('validation_error', e instanceof Error ? e : undefined);
            }

            // ✅ Validado: resolvemos YA para que el handler enganche el consumidor
            if (!resolved) {
              console.log('Resolviendo promesa en data con:', {
                filename,
                mimetype,
                password
              });
              resolve({
                filename,
                mimetype,
                password,
                stream: tee // el handler engancha el cifrado a este tee
              });
            }
          }
        }

        // Si ya resolvimos y no está destruido → forward con backpressure
        if (!tee.destroyed && !(tee as any).writableEnded) {
          if (!tee.write(chunk)) {
            file.pause();
            tee.once('drain', () => {
              if (!tee.destroyed && !(tee as any).writableEnded) file.resume();
            });
          }
        }
      });

      file.on('end', () => {
        if (!tee.destroyed && !(tee as any).writableEnded) {
          try {
            tee.end();
          } catch {}
        }
      });
    });

    bb.once('finish', () => {
      // Si no resolvimos antes, o faltó algo, devolvemos null con errores
      console.log('Resolviendo promesa en finish con:', {
        filename,
        mimetype,
        password
      });
      if (!resolved) {
        if (!sawFile) errors.push('No se encontró el campo "file"');
        if (!password) errors.push('No se encontró el campo "password"');
        resolve(null);
      }
      resolveOnce({
        filename,
        mimetype,
        password,
        stream: tee // el handler engancha el cifrado a este tee
      });
    });

    bb.once('error', (e: unknown) => {
      errors.push((e as Error)?.message ?? 'multipart_error');
      resolve(null);
    });
  });

  body.pipe(bb);
  const parsed = await parsedPromise;

  // Validaciones finales simples
  if (!parsed) return null;
  if (errors.length) return null;

  return parsed;
}
