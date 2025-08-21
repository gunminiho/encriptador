import { type BinaryLike, type ScryptOptions, scrypt as _scrypt } from 'crypto';
import { Transform } from 'stream';
import { normalizeFileName } from '@/shared/data_processing/converter';
import { ParsedMassiveRequest, FileEntryStream, PasswordMap, EncryptionResult, CONCURRENCY } from '@/custom-types';
import { createZipPackager, setupZipLogging } from './zipper';
import { makeWebZipStream } from '@/shared/data_processing/converter';
import { processFileEncryption } from './encryption';
import { unlinkQuiet } from './cleaningTempFiles';
import { MassivePipelineEvents, FileOkEvent } from '@/custom-types';

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
        //console.log(`[${label}] +${fmtMB(acc)}`);
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
  stopCallback: () => void,
  events?: MassivePipelineEvents // <- NUEVO
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
    //console.log(`⚡ Iniciando procesamiento concurrente de ${totalFiles} archivos...`);

    for await (const fileEntry of files) {
      const task = processFileWithSemaphoreAndCleanup(
        fileEntry,
        passwords,
        zipPackager,
        semaphore,
        results, // ⬇️ reenvía éxito de archivo hacia el handler
        (ev) => events?.on_file_ok?.(ev)
      );

      tasks.push(task);
    }

    await Promise.all(tasks);
    await zipPackager.finalize();

    //console.log(`🎉 ZIP finalizado exitosamente. ✅ ok:${results.ok}, ⚠️  missingPw:${results.missingPassword}, ❌ failed:${results.failed}`);
  } catch (error) {
    console.error('💥 Error en procesamiento de archivos:', error);
    try {
      zipPackager.abort(error);
    } catch (abortError) {
      console.error('Error abortando ZIP:', abortError);
    }
  } finally {
    // ⚡ LIMPIEZA FINAL GARANTIZADA
    //console.log('🧹 Iniciando limpieza final de archivos temporales...');
    stopCallback();
  }
}

async function processFileWithSemaphoreAndCleanup(
  fileEntry: FileEntryStream,
  passwords: PasswordMap,
  zipPackager: ReturnType<typeof createZipPackager>,
  semaphore: Semaphore,
  results: EncryptionResult,
  onOk?: (ev: FileOkEvent) => void
): Promise<void> {
  const release = await semaphore.acquire();

  try {
    const normalizedName = normalizeFileName(fileEntry.filename);
    const password = passwords.get(normalizedName);

    if (!password) {
      results.missingPassword++;
      results.status.push({
        file: fileEntry.filename,
        status: 'missing_password' // asegúrate de ser consistente con el resto del código
      });

      //console.warn(`⚠️  Password faltante para: ${fileEntry.filename}`);
      // consumimos el stream para no bloquear el pipeline
      fileEntry.stream.resume();
      return;
    }

    // 🔐 Encriptar (tu función ya espera hasta que se agregue al ZIP)
    const fileResult = await processFileEncryption(fileEntry, password, zipPackager);
    // fileResult esperado: { file: string; status: 'ok'|'error'; size?: number; message?: string }

    if (fileResult.status === 'ok') {
      results.ok++;
      // Emite evento hacia el handler (para logging en DB)
      const size = (fileResult as any).size ?? fileEntry.size ?? 0;

      const ext = fileEntry.ext ?? fileEntry.filename.split('.').pop()?.toLowerCase();

      onOk?.({
        name: fileEntry.filename,
        size: Number(size) || 0,
        ext,
        mimetype: fileEntry.mimetype
      });

      // console.log(`✅ ${fileEntry.filename} - ${(Number(size) / (1024 * 1024)).toFixed(2)}MB`);
    } else {
      results.failed++;
      console.error(`❌ ERROR ${fileEntry.filename}: ${(fileResult as any).message}`);
    }

    results.status.push(fileResult);
  } catch (err) {
    results.failed++;
    results.status.push({
      file: fileEntry.filename,
      status: 'error',
      message: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    // ⚡ LIMPIEZA INDIVIDUAL GARANTIZADA
    const tmp = fileEntry.tmpPath; // guarda antes
    if (tmp) {
      try {
        await unlinkQuiet(tmp);
      } catch (unlinkError) {
        console.warn(`⚠️  No se pudo eliminar ${tmp}:`, unlinkError);
      } finally {
        (fileEntry as any).tmpPath = undefined; // evita segundas pasadas
      }
    }
    release();
  }
}

export async function createMassiveEncryptionPipeline(
  parsedData: ParsedMassiveRequest,
  events?: MassivePipelineEvents
): Promise<{ webStream: ReadableStream<Uint8Array>; stop: () => void; done: Promise<void> }> {
  const { files, passwords, totalFiles, tempDir } = parsedData;

  const zipPackager = createZipPackager();
  const nodeZipStream = zipPackager.stream as unknown as NodeJS.ReadableStream;

  setupZipLogging(nodeZipStream);
  const { webStream, stop: originalStop } = makeWebZipStream(nodeZipStream);

  // ✅ Promesa que resuelve al cerrar el ZIP
  const done = new Promise<void>((resolve, reject) => {
    const onResolve = () => {
      nodeZipStream.off('end', onResolve);
      nodeZipStream.off('close', onResolve);
      nodeZipStream.off('error', onError);
      resolve();
    };
    const onError = (err: unknown) => {
      nodeZipStream.off('end', onResolve);
      nodeZipStream.off('close', onResolve);
      nodeZipStream.off('error', onError);
      reject(err);
    };
    nodeZipStream.once('end', onResolve);
    nodeZipStream.once('close', onResolve);
    nodeZipStream.once('error', onError);
  });

  // ⚡ STOP MEJORADO
  const enhancedStop = () => {
    originalStop();
    // Limpieza adicional si la necesitas
    // cleanupRequestDirectory(tempDir).catch(() => {});
  };

  // Procesamiento concurrente + limpieza (REENVÍA eventos)
  processFilesAsyncWithCleanup(
    files,
    passwords,
    totalFiles,
    zipPackager,
    tempDir,
    enhancedStop,
    events // <- NUEVO parámetro
  );

  return { webStream, stop: enhancedStop, done };
}
