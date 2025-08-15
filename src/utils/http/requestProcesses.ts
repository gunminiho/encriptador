import { PayloadRequest, addDataAndFileToRequest } from 'payload';
import Busboy from 'busboy';
import { toNodeReadable, toPlainHeaders } from '../data_processing/converter';
import { sanitizePassword } from '../data_processing/validator';
import type { PayloadFileRequest, MassiveEncryptionRequest, SingleEncryptionRequest, FileEntryStream, PasswordMap } from '@/custom-types';
import { HWM } from '@/custom-types';
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
export async function getSingleStreamFromBusboy(req: PayloadRequest, errors: Array<string>): Promise<{ filename: string; mimetype: string; stream: NodeReadable; password: string }> {
  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);
  const bb = Busboy({ headers, limits: { files: 1, fields: 6 } });

  let filename = 'file.enc';
  let mimetype = 'application/octet-stream';
  let password = '';
  let streamResolved = false;

  const tee = new PassThrough({ highWaterMark: HWM });

  const done = new Promise<void>((resolve, reject) => {
    bb.on('field', (name, val) => {
      if (name === 'password') password = sanitizePassword(val);
    });

    bb.on('file', (_field, file, info) => {
      if (streamResolved) {
        file.resume(); // ignora archivos extra
        return;
      }
        filename = info.filename ?? filename;
        mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;

      file.pipe(tee);
      streamResolved = true;
    });

    bb.once('error', reject);
    bb.once('finish', resolve);
  });

  body.pipe(bb);
  await done;

  if (!streamResolved) throw new Error('missing_file_part');
  if (!password) throw new Error('missing_password');

  return { filename, mimetype, stream: tee, password };
}
