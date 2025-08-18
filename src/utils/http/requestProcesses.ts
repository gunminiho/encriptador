import { PayloadRequest, addDataAndFileToRequest } from 'payload';
import Busboy from 'busboy';
import { toNodeReadable, toPlainHeaders } from '../data_processing/converter';
import { sanitizePassword } from '../data_processing/validator';
import type { PayloadFileRequest, MassiveEncryptionRequest, SingleEncryptionRequest, FileEntryStream, PasswordMap, ParsedMassiveRequest } from '@/custom-types';
import { HWM } from '@/custom-types';
import { isAllowedFile } from '../data_processing/fileChecker';
import { PassThrough, Readable, type Readable as NodeReadable, Transform } from 'node:stream';
import { parsePasswordsCsv } from '@/utils/data_processing/csvParser';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { cleanupRequestDirectory } from '../data_processing/cleaningTempFiles';
import { handleError } from './response';

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

/* ========== Parser SINGLE streaming con validaciones integradas ========== */
export async function getSingleStreamAndValidateFromBusboyX(
  req: PayloadRequest,
  errors: Array<string>,
  validationRules?: string[] // Array opcional de reglas específicas a validar
): Promise<{ filename: string; mimetype: string; stream: NodeReadable; password: string }> {
  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);
  const bb = Busboy({ headers, limits: { files: 1, fileSize: 500 * 1024 * 1024 } });

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
        console.log('Password:', password);
      }
    });

    bb.on('file', async (_field, file, info) => {
      console.log('verificando que no este resuelto');
      if (streamResolved) {
        file.resume(); // ignora archivos extra
        return;
      }

      filename = info.filename ?? filename;
      mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;
      //console.log('Filename:', filename, 'MIME Type:', mimetype);

      // Configurar el pipeline con contador de tamaño
      file.pipe(sizeCounter).pipe(tee);
      streamResolved = true;

      console.log('Haciendo validaciones:', "if (validationRules?.includes('file-type-validation')) {");
      // Si necesitamos validar el contenido del archivo, guardamos un buffer pequeño
      if (validationRules?.includes('file-type-validation')) {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        const maxBufferSize = 256 * 1024; // 256KB para análisis de tipo

        file.on('data', (chunk: Buffer) => {
          if (totalSize < maxBufferSize) {
            console.log('totalSize:', totalSize);
            console.log('chunk.length:', chunk.length);
            chunks.push(chunk);
            totalSize += chunk.length;
          }
          else {
            file.resume(); // Ignorar el resto del archivo
          }
        });
        

        file.on('limit', () => {
          console.log('llegue al limite!');
          reject(new Error('El archivo excede el tamaño permitido: ' + process.env.FILE_SIZE_LIMIT + 'MB'));
        });

        file.on('end', () => {
          console.log('Termine de validar el tipo de archivo');
          fileBuffer = Buffer.concat(chunks);
        });
      }
    });

    bb.once('error', () => {
      console.log('rejecteando!');
      reject();
    });
    bb.once('finish', async () => {
      // Realizar validaciones después de procesar todos los datos
      await performValidations();
      console.log('Termine de validar el tipo de archivo');
      resolve();
    });
  });

  // Función interna para realizar todas las validaciones
  const performValidations = async () => {
    console.log('entrando perform Validations');
    try {
      // ✅ Validación de archivo presente
      if (!streamResolved) {
        errors.push('No se detectó archivo para encriptar');
      }

      // ✅ Validación de contraseña
      if (!password) {
        errors.push('No se detectó password para encriptar');
      } else if (typeof password !== 'string') {
        errors.push('La contraseña debe ser un string');
      }

      // ✅ Validación de tamaño de archivo
      const maxSizeMB = Number(process.env.FILE_SIZE_LIMIT) || 10; // Default 10MB
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      console.log('MB:', maxSizeMB, 'bytes:', maxSizeBytes);
      console.log('fileSize:', fileSize);

      if (fileSize > maxSizeBytes) {
        errors.push(`El archivo excede el tamaño máximo permitido de ${maxSizeMB}MB`);
      }

      // ✅ Validación de tipo de archivo (opcional)
      if (validationRules?.includes('file-type-validation') && fileBuffer && streamResolved) {
        try {
          const { allowed, extension, mimeType } = await isAllowedFile(fileBuffer, filename);
          if (!allowed && extension !== 'unknown') {
            errors.push(`El tipo de archivo .${extension} o mime-type ${mimeType} no está permitido`);
          }
        } catch (typeError) {
          console.warn('Error en validación de tipo de archivo:', typeError);
          errors.push('No se pudo validar el tipo de archivo');
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

export async function getSingleStreamAndValidateFromBusboy(
  req: PayloadRequest,
  errors: Array<string>,
  validationRules?: string[]
): Promise<{ filename: string; mimetype: string; stream: NodeReadable; password: string }> {
  const headers = toPlainHeaders((req as any).headers ?? req.headers);
  const body = toNodeReadable(req);
  const bb = Busboy({ headers, limits: { files: 1, fields: 6, fileSize: 500 * 1024 * 1024 } });

  let filename = 'file.enc';
  let mimetype = 'application/octet-stream';
  let password = '';
  let streamResolved = false;
  let fileSize = 0;
  let fileBuffer: Buffer | null = null;
  let bufferReadyPromise: Promise<void> = Promise.resolve(); // Default resuelto

  const tee = new PassThrough({ highWaterMark: HWM });

  const done = new Promise<void>((resolve, reject) => {
    bb.on('field', (name, val) => {
      if (name === 'password') {
        password = sanitizePassword(val);
        console.log('Password:', password);
      }
    });

    bb.on('file', async (_field, file, info) => {
      console.log('verificando que no este resuelto');
      if (streamResolved) {
        file.resume();
        return;
      }

      filename = info.filename ?? filename;
      mimetype = (info as any).mimeType ?? (info as any).mimetype ?? mimetype;
      console.log('Filename:', filename, 'MIME Type:', mimetype);

      streamResolved = true;

      console.log('Haciendo validaciones:', "if (validationRules?.includes('file-type-validation')) {");
      
      // ✅ SOLUCIÓN: Crear transforms que capturen datos Y los pasen
      if (validationRules?.includes('file-type-validation')) {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        const maxBufferSize = 1024 * 1024;

        // Promesa que se resuelve cuando el buffer está listo
        bufferReadyPromise = new Promise<void>((resolveBuffer) => {
          // Transform que captura datos para el buffer Y los pasa adelante
          const bufferCapture = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              // Capturar para buffer de validación
              if (totalSize < maxBufferSize) {
                console.log('Capturando chunk para validación');
                chunks.push(Buffer.from(chunk)); // Copiar el chunk
                totalSize += chunk.length;
              }
              
              // Pasar el chunk adelante sin modificarlo
              cb(null, chunk);
            },
            flush(cb) {
              // Cuando termina de procesar todos los chunks
              console.log('BufferCapture terminado - creando buffer final');
              fileBuffer = Buffer.concat(chunks);
              console.log('Buffer creado con tamaño:', fileBuffer.length);
              resolveBuffer(); // ✅ Resolver la promesa aquí
              cb();
            }
          });

          // Transform para contar tamaño
          const sizeCounter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              fileSize += chunk.length;
              cb(null, chunk);
            }
          });

          // Pipeline: file -> bufferCapture -> sizeCounter -> tee
          file.pipe(bufferCapture).pipe(sizeCounter).pipe(tee);
        });

        file.on('limit', () => {
          console.log('llegue al limite!');
          reject(new Error('El archivo excede el tamaño permitido: ' + process.env.FILE_SIZE_LIMIT + 'MB'));
        });

      } else {
        // Si no necesitamos validación de tipo, solo contador de tamaño
        const sizeCounter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            fileSize += chunk.length;
            cb(null, chunk);
          }
        });

        file.pipe(sizeCounter).pipe(tee);

        file.on('limit', () => {
          console.log('llegue al limite!');
          reject(new Error('El archivo excede el tamaño permitido: ' + process.env.FILE_SIZE_LIMIT + 'MB'));
        });
      }
    });

    bb.once('error', (err) => {
      console.log('Error en Busboy:', err);
      reject(err);
    });

    bb.once('finish', async () => {
      try {
        console.log('Busboy terminó - esperando que termine el buffer...');
        
        // ✅ Esperar a que el buffer esté listo antes de validar
        await bufferReadyPromise;
        console.log('Buffer listo - iniciando validaciones');
        
        await performValidations();
        console.log('Validaciones completadas');
        resolve();
      } catch (error) {
        console.error('Error en validaciones:', error);
        reject(error);
      }
    });
  });

  // Función interna para realizar todas las validaciones
  const performValidations = async () => {
    console.log('entrando perform Validations');
    try {
      // ✅ Validación de archivo presente
      if (!streamResolved) {
        errors.push('No se detectó archivo para encriptar');
      }

      // ✅ Validación de contraseña
      if (!password) {
        errors.push('No se detectó password para encriptar');
      } else if (typeof password !== 'string') {
        errors.push('La contraseña debe ser un string');
      }

      // ✅ Validación de tamaño de archivo
      const maxSizeMB = Number(process.env.FILE_SIZE_LIMIT) || 10;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      console.log('MB:', maxSizeMB, 'bytes:', maxSizeBytes);
      console.log('fileSize:', fileSize);

      if (fileSize > maxSizeBytes) {
        errors.push(`El archivo excede el tamaño máximo permitido de ${maxSizeMB}MB`);
      }

      // ✅ Validación de tipo de archivo (opcional)
      if (validationRules?.includes('file-type-validation') && streamResolved) {
        if (!fileBuffer || fileBuffer.length === 0) {
          console.warn('Buffer vacío - no se puede validar tipo de archivo');
          errors.push('No se pudo analizar el tipo de archivo');
        } else {
          console.log('Validando tipo de archivo - Buffer size:', fileBuffer.length);
          try {
            const { allowed, extension, mimeType } = await isAllowedFile(fileBuffer, filename);
            if (!allowed && extension !== 'unknown') {
              errors.push(`El tipo de archivo .${extension} o mime-type ${mimeType} no está permitido`);
            }
          } catch (typeError) {
            console.warn('Error en validación de tipo de archivo:', typeError);
            errors.push('No se pudo validar el tipo de archivo');
          }
        }
      }

      // ✅ Validaciones adicionales personalizadas
      if (validationRules?.includes('filename-validation')) {
        if (!filename || filename === 'file.enc') {
          errors.push('El archivo debe tener un nombre válido');
        }

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
    maxFiles: process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 10000, // Máximo de archivos
    maxTotalSizeGB: process.env.MAX_TOTAL_SIZE_GB ? parseInt(process.env.MAX_TOTAL_SIZE_GB, 10) : 2048, // 2GB total
    maxFileSizeMB: process.env.MAX_FILE_SIZE_MB ? parseFloat(process.env.MAX_FILE_SIZE_MB) : 20
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
    throw new Error('Failed to create temp directory');
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
    if (fieldname === 'passwords' && filename.toLowerCase().endsWith('.csv')) {
      file.on('data', (d: Buffer) => pwCsvChunks.push(d));
      file.on('error', () => void 0);
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
    console.log(`📁 Procesando archivo ${totalFiles}/${limits.maxFiles}: ${filename}`);

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
          console.log(`📊 Archivo ${filename}: ${(fileSize / (1024 * 1024)).toFixed(2)}MB. Total acumulado: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)}MB`);
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
      console.log(`🏁 Parsing completo. Esperando ${spoolPromises.length} archivos...`);

      // Esperar todos los archivos, incluso los que fallaron
      await Promise.allSettled(spoolPromises);

      console.log(`✅ Spooling completado. Archivos válidos: ${fileList.length}/${totalFiles}`);
      console.log(`📦 Tamaño total: ${(totalSizeBytes / (1024 * 1024)).toFixed(2)}MB`);

      resolve();
    });
  });

  nodeBody.pipe(busboy);

  try {
    await parsingComplete;
  } catch (error) {
    // Si hay error en el parsing, limpiar todo
    await cleanupRequestDirectory(tempDir);
    throw error;
  }

  queue.push('EOS');
  wake();

  const passwords = await parsePasswordsCsv(Buffer.concat(pwCsvChunks));

  return {
    files: filesGenerator(),
    passwords,
    totalFiles: fileList.length, // Solo archivos válidos
    totalSizeBytes,
    fileList,
    tempDir
  };
}
