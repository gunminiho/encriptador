import { type BinaryLike, type ScryptOptions, scrypt as _scrypt } from 'crypto';
import { Transform } from 'stream';
import { fmtMB, normalizeFileName } from '@/utils/data_processing/converter';
import { ParsedMassiveRequest, FileEntryStream, PasswordMap, EncryptionResult, CONCURRENCY } from '@/custom-types';
import { createZipPackager, setupZipLogging } from './zipper';
import { makeWebZipStream } from '@/utils/data_processing/converter';
import { processFileEncryption } from './encryption';
import fs from 'fs';
import { cleanupRequestDirectory } from './cleaningTempFiles';
//import { handleError } from '@/utils/http/response';
import { processFilesAsync } from './concurrency';

// ==========================
// Helpers internos
// ==========================
// esta clase controla el acceso concurrente a un recurso
// permite un número máximo de operaciones simultáneas
// y gestiona una cola de espera
// para controlar el acceso a un recurso compartido
// se usa para limitar el número de tareas de cifrado que se pueden ejecutar al mismo tiempo
export class Semaphore {
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

// Función para scrypt (derivación de clave)
// esta implementación utiliza promesas para facilitar su uso con async/await porque permite un manejo más sencillo de errores y evita el callback hell
export const scryptAsync = (password: BinaryLike, salt: BinaryLike, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    _scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });

// Tap transform stream para logging
// sirve para registrar el tamaño de los datos procesados
export function tap(label: string, stepBytes = 5 * 1024 * 1024) {
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

async function processFilesAsyncWithCleanup(
  files: AsyncGenerator<FileEntryStream, void, void>,
  passwords: PasswordMap,
  totalFiles: number,
  zipPackager: ReturnType<typeof createZipPackager>,
  tempDir: string,
  stopCallback: () => void
): Promise<void> {
  const semaphore = new Semaphore(CONCURRENCY);
  const tasks: Promise<void>[] = [];
  const results: EncryptionResult = {
    ok: 0,
    missingPassword: 0,
    failed: 0,
    status: []
  };

  try {
    console.log(`⚡ Iniciando procesamiento concurrente de ${totalFiles} archivos...`);

    for await (const fileEntry of files) {
      const task = processFileWithSemaphoreAndCleanup(fileEntry, passwords, zipPackager, semaphore, results);

      tasks.push(task);
    }

    await Promise.all(tasks);
    await zipPackager.finalize();

    console.log(`🎉 ZIP finalizado exitosamente. ✅ ok:${results.ok}, ⚠️  missingPw:${results.missingPassword}, ❌ failed:${results.failed}`);
  } catch (error) {
    console.error('💥 Error en procesamiento de archivos:', error);
    try {
      zipPackager.abort(error);
    } catch (abortError) {
      console.error('Error abortando ZIP:', abortError);
    }
  } finally {
    // ⚡ LIMPIEZA FINAL GARANTIZADA
    console.log('🧹 Iniciando limpieza final de archivos temporales...');
    stopCallback();
  }
}

async function processFileWithSemaphoreAndCleanup(
  fileEntry: FileEntryStream,
  passwords: PasswordMap,
  zipPackager: ReturnType<typeof createZipPackager>,
  semaphore: Semaphore,
  results: EncryptionResult
): Promise<void> {
  const release = await semaphore.acquire();

  try {
    const normalizedName = normalizeFileName(fileEntry.filename);
    const password = passwords.get(normalizedName);

    if (!password) {
      results.missingPassword++;
      results.status.push({
        file: fileEntry.filename,
        status: 'missing_password'
      });

      console.warn(`⚠️  Password faltante para: ${fileEntry.filename}`);
      fileEntry.stream.resume();
      return;
    }

    console.log(`🔐 Encriptando: ${fileEntry.filename}`);
    const fileResult = await processFileEncryption(fileEntry, password, zipPackager);

    if (fileResult.status === 'ok') {
      results.ok++;
      console.log(`✅ ${fileEntry.filename} - ${((fileResult as any).size / (1024 * 1024)).toFixed(2)}MB`);
    } else {
      results.failed++;
      console.error(`❌ ERROR ${fileEntry.filename}: ${(fileResult as any).message}`);
    }

    results.status.push(fileResult);
  } finally {
    // ⚡ LIMPIEZA INDIVIDUAL GARANTIZADA
    if (fileEntry.tmpPath) {
      try {
        await fs.promises.unlink(fileEntry.tmpPath);
        // console.log(`🗑️  Eliminado: ${path.basename(fileEntry.tmpPath)}`);
      } catch (unlinkError) {
        console.warn(`⚠️  No se pudo eliminar ${fileEntry.tmpPath}:`, unlinkError);
      }
    }
    release();
  }
}

export async function createMassiveEncryptionPipeline(parsedData: ParsedMassiveRequest): Promise<{ webStream: ReadableStream<Uint8Array>; stop: () => void }> {
  const { files, passwords, totalFiles, tempDir } = parsedData;

  const zipPackager = createZipPackager();
  const nodeZipStream = zipPackager.stream as unknown as NodeJS.ReadableStream;

  setupZipLogging(nodeZipStream);
  const { webStream, stop: originalStop } = makeWebZipStream(nodeZipStream);

  // ⚡ STOP MEJORADO - Incluye limpieza automática
  const enhancedStop = () => {
    console.log('🛑 Deteniendo pipeline y limpiando archivos temporales...');
    originalStop();

    // Limpiar de forma asíncrona sin bloquear
    cleanupRequestDirectory(tempDir).catch((error) => {
      console.error('Error en limpieza post-procesamiento:', error);
    });
  };

  // Procesar archivos con limpieza automática
  processFilesAsyncWithCleanup(files, passwords, totalFiles, zipPackager, tempDir, enhancedStop);

  return { webStream, stop: enhancedStop };
}
