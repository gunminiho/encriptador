// PayloadCMS handler: multipart → spool a disco → AES-256-GCM por archivo → ZIP en streaming
// con logs de progreso y limpieza de temporales.
// massiveEncryption2.ts
import type { PayloadRequest } from 'payload';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { getMassiveRequestStreams } from '@/utils/http/requestProcesses';
import { CONCURRENCY, ZIP_LOG_STEP, FileStatus } from '@/custom-types';
import { normalizeFileName, makeWebZipStream } from '@/utils/data_processing/converter';
import { Semaphore, tap } from '@/utils/data_processing/trafficController';
import { createZipPackager } from '@/utils/data_processing/zipper';
import { encryptStreamGCM } from '@/utils/data_processing/encryption';

export async function massiveEncryptionHandler2(req: PayloadRequest): Promise<Response> {
  console.time('⏱️ massive-encrypt');
  //console.log('[handler] inicio');
  const { files, passwords } = await getMassiveRequestStreams(req);
  //console.log('[handler] archivos a procesar:', totalFiles);

  const zip = createZipPackager();
  const nodeZipStream = zip.stream as unknown as NodeJS.ReadableStream;

  // logs del ZIP (Node)
  let zipAcc = 0;
  nodeZipStream.on('data', (chunk: Buffer) => {
    zipAcc += chunk.length;
    if (zipAcc >= ZIP_LOG_STEP) {
      //console.log(`[zip.node] +${fmtMB(zipAcc)} acumulados`);
      zipAcc = 0;
    }
  });
  //nodeZipStream.on('end', () => console.log('[zip.node] end'));
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
      //console.log(`[worker] start ${f.filename} (${started}/${totalFiles})`);
      const key = normalizeFileName(f.filename);
      const pw = passwords.get(key);

      const t = (async () => {
        const release = await sem.acquire();
        try {
          if (!pw) {
            missingPw++;
            status.push({ file: f.filename, status: 'missing_password' });
            //console.log(`[worker] missing_password ${f.filename}`);
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
          //console.log(`[worker] OK ${f.filename} (${fmtMB(meta.size)}) [ok:${ok} missing:${missingPw} fail:${failed}]`);
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
          //console.log(`[worker] progreso: ${finished}/${totalFiles}\r`);
          release();
        }
      })();
      tasks.push(t);
    }

    try {
      await Promise.all(tasks);
      //console.log('[worker] todos procesados, finalizando ZIP…');
      await zip.finalize();
      console.log(`[worker] ✅ ZIP finalizado. ok:${ok}, missingPw:${missingPw}, failed:${failed}`);
      //console.dir(status, { depth: 1 });
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

  const cd = `attachment; filename="${`encrypted_${uuidv4()}.zip`}"; filename*=UTF-8''${encodeURIComponent(`encrypted_${uuidv4()}.zip`)}`;
  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': cd,
    'Cache-Control': 'private, no-store, no-transform',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
  });
  //console.log('[handler] creando Response (Fetch)');
  const response = new Response(webStream, { headers });
  //console.log('[handler] Response creada y retornada');
  return response;
}
