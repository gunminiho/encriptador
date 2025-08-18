import { FileEntryStream, PasswordMap, EncryptionResult, CONCURRENCY, FileStatus } from '@/custom-types';
import { createZipPackager } from './zipper';
import { Semaphore } from './trafficController';
import { normalizeFileName } from './converter';
import { processFileEncryption } from './encryption';
import fs from 'fs';

async function processFileWithSemaphore(
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
      fileEntry.stream.resume();
      return;
    }

    const fileResult: FileStatus = await processFileEncryption(fileEntry, password, zipPackager);

    if (fileResult.status === 'ok') {
      results.ok++;
    } else {
      results.failed++;
      console.error(`[worker] ERROR ${fileEntry.filename}:`, fileResult);
    }

    results.status.push(fileResult);
  } finally {
    // Limpiar archivo temporal
    if (fileEntry.tmpPath) {
      try {
        await fs.promises.unlink(fileEntry.tmpPath);
      } catch {}
    }
    release();
  }
}

export async function processFilesAsync(
  files: AsyncGenerator<FileEntryStream, void, void>,
  passwords: PasswordMap,
  totalFiles: number,
  zipPackager: ReturnType<typeof createZipPackager>,
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
    for await (const fileEntry of files) {
      const task = processFileWithSemaphore(fileEntry, passwords, zipPackager, semaphore, results);

      tasks.push(task);
    }

    await Promise.all(tasks);
    await zipPackager.finalize();

    console.log(`[worker] ✅ ZIP finalizado. ok:${results.ok}, missingPw:${results.missingPassword}, failed:${results.failed}`);
  } catch (error) {
    console.error('[worker] error en procesamiento:', error);
    try {
      zipPackager.abort(error);
    } catch {}
  } finally {
    stopCallback();
  }
}
