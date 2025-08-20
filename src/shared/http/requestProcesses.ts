import { PayloadRequest } from 'payload';
import Busboy from 'busboy';
import { toNodeReadable, toPlainHeaders } from '../data_processing/converter';
import { sanitizePassword } from '../data_processing/validator';
import type { FileEntryStream, ParsedMassiveRequest } from '@/custom-types';
import { HWM } from '@/custom-types';
import { isAllowedFile } from '../data_processing/fileChecker';
import { PassThrough, Readable, type Readable as NodeReadable, Transform } from 'node:stream';
import { parsePasswordsCsv } from '@/shared/data_processing/csvParser';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FILE_SIZE_LIMIT = process.env.FILE_SIZE_LIMIT ? parseInt(process.env.FILE_SIZE_LIMIT, 10) : 20; // Tamaño máximo de archivo en MB, por defecto 20MB

/* ============================== Multipart (spool a disco + EOS correcto) ============================== */
// Parser de la solicitud multipart en streaming -> genera archivos + Map de passwords
// Cifrado por streaming AES-256-GCM (no bloquea Event Loop; usa scrypt async)
/* ========== Parser SINGLE streaming con validaciones integradas ========== */
export async function getSingleStreamAndValidateFromBusboy(
  req: PayloadRequest,
  errors: Array<string>,
  validationRules?: string[] // Array opcional de reglas específicas a validar
): Promise<{ filename: string; mimetype: string; stream: NodeReadable; password: string }> {
  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);

  const bb = Busboy({ headers, limits: { files: 1, fileSize: FILE_SIZE_LIMIT * 1024 * 1024, fields: 1, parts: 2 } });

  let filename = 'file.enc';
  let mimetype = 'application/octet-stream';
  let password = '';
  let streamResolved = false;
  let fileSize = 0;
  let fileBuffer: Buffer | null = null; // Para validaciones que requieren el contenido

  const tee = new PassThrough({ highWaterMark: HWM });

  // Transform para contar el tamaño del archivo
  const sizeCounter = new Transform({
    transform(chunk, _enc, cb) {
      fileSize += (chunk as Buffer).length;
      cb(null, chunk);
    }
  });

  const done = new Promise<void>((resolve, reject) => {
    bb.on('field', (name, val) => {
      if (name === 'password') {
        password = sanitizePassword(val);
      }
    });

    bb.on('file', async (_field, file, info) => {
      if (streamResolved) {
        file.resume(); // ignora archivos extra
        return;
      }

      filename = info.filename ?? filename;
      mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;

      // Configurar el pipeline con contador de tamaño
      file.pipe(sizeCounter).pipe(tee);
      streamResolved = true;

      // Si necesitamos validar el contenido del archivo, guardamos un buffer pequeño
      if (validationRules?.includes('file-type-validation')) {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        const maxBufferSize = 1 * 1024; // 1KB para análisis de tipo

        file.on('data', (chunk: Buffer) => {
          if (totalSize < maxBufferSize) {
            chunks.push(chunk);
            totalSize += chunk.length;
          } else file.resume();
        });
        file.on('limit', () => errors.push('El archivo excede el tamaño permitido: ' + FILE_SIZE_LIMIT + 'MB'));
        file.on('end', () => (fileBuffer = Buffer.concat(chunks)));
      }
    });

    bb.once('error', (e: Error) => {
      errors.push('Error en la carga del archivo: ' + e.message);
      reject();
    });
    bb.once('finish', async () => {
      // Realizar validaciones después de procesar todos los datos
      await performValidations();
      resolve();
    });
  });

  // Función interna para realizar todas las validaciones
  const performValidations = async () => {
    try {
      // ✅ Validación de archivo presente
      if (!streamResolved) {
        errors.push('No se detectó archivo para encriptar');
      }

      // ✅ Validación de contraseña
      if (password === '') {
        errors.push('No se detectó password para encriptar');
      } else if (typeof password !== 'string') {
        errors.push('La contraseña debe ser un string');
      }

      // ✅ Validación de tamaño de archivo
      const maxSizeMB = FILE_SIZE_LIMIT;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      if (fileSize > maxSizeBytes) {
        errors.push(`El archivo excede el tamaño máximo permitido de ${maxSizeMB}MB`);
      }

      // ✅ Validación de tipo de archivo (opcional)
      if (validationRules?.includes('file-type-validation') && fileBuffer && streamResolved) {
        try {
          const { allowed, extension, mimeType } = await isAllowedFile(fileBuffer, filename);
          if (!allowed && extension !== 'unknown') errors.push(`El tipo de archivo .${extension} o mime-type ${mimeType} no está permitido`);
        } catch (typeError: any) {
          console.warn('Error en validación de tipo de archivo:', typeError);
          errors.push('No se pudo validar el tipo de archivo', typeError.message);
        }
      }

      // ✅ Validaciones adicionales personalizadas
      if (validationRules?.includes('filename-validation')) {
        if (!filename || filename === 'file.enc') {
          errors.push('El archivo debe tener un nombre válido');
        }

        // Validar caracteres peligrosos en el nombre
        const dangerousChars = /[<>:"/\\|?*\x00-\x1F]/;
        if (dangerousChars.test(filename)) {
          errors.push('El nombre del archivo contiene caracteres no permitidos');
        }
      }

      if (validationRules?.includes('password-strength')) {
        if (password.length < 1) {
          errors.push('La contraseña debe tener al menos 1 carácter');
        }
      }
    } catch (validationError) {
      console.error('Error durante validaciones:', validationError);
      errors.push('Error interno durante la validación del archivo');
    }
  };

  body.pipe(bb);
  await done;

  return { filename, mimetype, stream: tee, password };
}

export async function parseMassiveEncryptionRequest(request: PayloadRequest, errors: string[]): Promise<ParsedMassiveRequest> {
  // Configurar límites
  const limits = {
    maxFiles: process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 1000, // Máximo de archivos
    maxTotalSizeGB: process.env.MAX_TOTAL_SIZE_GB ? parseInt(process.env.MAX_TOTAL_SIZE_GB, 10) : 2, // GB total
    maxFileSizeMB: process.env.FILE_SIZE_LIMIT ? parseFloat(process.env.FILE_SIZE_LIMIT) : 20 // MB por archivo máximo
  };

  const maxTotalSizeBytes = limits.maxTotalSizeGB * 1024 * 1024 * 1024;
  const maxFileSizeBytes = limits.maxFileSizeMB * 1024 * 1024;

  // Crear carpeta temporal única para este request
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(os.tmpdir(), 'payload-encrypt', requestId);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
  } catch (error) {
    errors.push('No se pudo crear directorio temporal para el procesamiento');
    throw new Error('No se pudo crear directorio temporal para el procesamiento en parseMassiveEncryptionRequest()');
  }

  const maybeWebBody: any = (request as any).body ?? null;
  const nodeBody: NodeReadable = typeof (Readable as any).fromWeb === 'function' && maybeWebBody?.getReader ? (Readable as any).fromWeb(maybeWebBody) : (request as any);

  const headers = toPlainHeaders(request.headers);
  const busboy = Busboy({ headers });

  const pwCsvChunks: Buffer[] = [];
  const queue: Array<FileEntryStream | 'EOS'> = [];
  const fileList: FileEntryStream[] = [];
  const spoolPromises: Promise<void>[] = [];

  let totalFiles = 0;
  let totalSizeBytes = 0;
  let shouldStopProcessing = false; // Flag para detener procesamiento
  let passwordFile = false;

  let wake!: () => void;
  let wait = new Promise<void>((r) => (wake = r));

  async function* filesGenerator() {
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

    // Handle passwords CSV
    if (fieldname === 'passwords' && filename.toLowerCase().endsWith('.csv') && !passwordFile) {
      file.on('data', (d: Buffer) => pwCsvChunks.push(d));
      file.on('error', () => void 0);
      passwordFile = true;
      return;
    }

    // ⚡ LÍMITE DE ARCHIVOS - Parar inmediatamente
    if (totalFiles >= limits.maxFiles) {
      if (!shouldStopProcessing) {
        errors.push(`Límite de archivos excedido. Máximo ${limits.maxFiles} archivos permitidos`);
        shouldStopProcessing = true;
      }
      file.resume(); // Descartar este archivo
      return;
    }

    totalFiles++;
    //process.stdout.write(`📁 Procesando archivo ${totalFiles}/${limits.maxFiles}: ${filename}`);

    // Crear path único en la carpeta temporal del request
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tempDir, `${totalFiles}_${Date.now()}_${safeFilename}`);
    const writeStream = fs.createWriteStream(tmpPath, { highWaterMark: HWM });

    let fileSize = 0;
    let fileSizeExceeded = false;

    // Transform stream para validar límites en tiempo real
    const limitsValidator = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (shouldStopProcessing || fileSizeExceeded) {
          // Si ya decidimos parar, no procesar más chunks
          cb();
          return;
        }

        fileSize += chunk.length;

        // ⚡ LÍMITE POR ARCHIVO - Parar este archivo específico
        if (fileSize > maxFileSizeBytes) {
          if (!fileSizeExceeded) {
            errors.push(`Archivo ${filename} excede el tamaño máximo de ${limits.maxFileSizeMB}MB`);
            fileSizeExceeded = true;
            shouldStopProcessing = true;
          }
          cb();
          return;
        }

        // ⚡ LÍMITE TOTAL - Parar todo el procesamiento
        const newTotalSize = totalSizeBytes + fileSize;
        if (newTotalSize > maxTotalSizeBytes) {
          if (!shouldStopProcessing) {
            const currentGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
            errors.push(`Límite de tamaño total excedido. Tamaño actual: ${currentGB}GB, máximo: ${limits.maxTotalSizeGB}GB`);
            shouldStopProcessing = true;
          }
          cb();
          return;
        }

        cb(null, chunk);
      },

      flush(cb) {
        // Solo actualizar el tamaño total si el archivo se procesó completamente
        if (!fileSizeExceeded && !shouldStopProcessing) {
          totalSizeBytes += fileSize;
          //console.log(`📊 Archivo ${filename}: ${(fileSize / (1024 * 1024)).toFixed(2)}MB. Total acumulado: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)}MB`);
        }
        cb();
      }
    });

    file.pipe(limitsValidator).pipe(writeStream);

    const spoolPromise = new Promise<void>((resolve) => {
      writeStream.once('finish', () => {
        // Solo agregar a las listas si no hubo problemas
        if (!shouldStopProcessing && !fileSizeExceeded && fileSize > 0) {
          const fileEntry: FileEntryStream = {
            fieldname,
            filename,
            mimetype: mimeType,
            stream: fs.createReadStream(tmpPath, { highWaterMark: HWM }),
            tmpPath
          };

          queue.push(fileEntry);
          fileList.push({
            ...fileEntry,
            stream: fs.createReadStream(tmpPath, { highWaterMark: HWM })
          });
        } else {
          // Limpiar archivo si no es válido
          fs.promises.unlink(tmpPath).catch(() => {});
        }

        wake();
        resolve();
      });

      writeStream.once('error', (err) => {
        console.error(`Error spooling archivo ${filename}:`, err);
        errors.push(`Error al procesar archivo ${filename}: ${err.message}`);

        // Limpiar archivo con error
        fs.promises.unlink(tmpPath).catch(() => {});

        try {
          file.resume();
        } catch {}
        resolve();
      });

      limitsValidator.once('error', (err) => {
        console.error(`Error en validación de límites para ${filename}:`, err);
        errors.push(`Error en validación de límites para archivo ${filename}: ${err.message}`);
        writeStream.destroy();
        resolve();
      });
    });

    spoolPromises.push(spoolPromise);

    // Si ya debemos parar, no procesar más archivos
    if (shouldStopProcessing) {
      file.resume();
      return;
    }
  });

  // Esperar a que termine el parsing
  const parsingComplete = new Promise<void>((resolve, reject) => {
    busboy.once('error', (err) => {
      console.error('Error en busboy:', err);
      reject(err);
    });

    busboy.once('close', async () => {
      //console.log(`🏁 Parsing completo. Esperando ${spoolPromises.length} archivos...`);

      // Esperar todos los archivos, incluso los que fallaron
      await Promise.allSettled(spoolPromises);

      //console.log(`✅ Spooling completado. Archivos válidos: ${fileList.length}/${totalFiles}`);
      //console.log(`📦 Tamaño total: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)}MB`);

      resolve();
    });
  });

  nodeBody.pipe(busboy);

  try {
    await parsingComplete;
  } catch (error) {
    // Si hay error en el parsing, limpiar todo
    //await cleanupRequestDirectory(tempDir);
    throw error;
  }

  queue.push('EOS');
  wake();

  const passwords = await parsePasswordsCsv(Buffer.concat(pwCsvChunks));

  return {
    files: filesGenerator(),
    passwords,
    passwordFile,
    totalFiles: fileList.length, // Solo archivos válidos
    totalSizeBytes,
    fileList,
    tempDir
  };
}
