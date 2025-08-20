// src/services/encryption.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { PassThrough } from 'stream';
import { HWM, keyLen, SCRYPT, SALT_LEN, IV_LEN, TAG_LEN, FileStatus, FileEntryStream } from '@/custom-types';
import { readExactlyHeader, HoldbackTransform } from './validator';
import { type Readable as NodeReadable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { scryptAsync } from '@/shared/data_processing/trafficController';
import { createZipPackager } from './zipper';
import { tap } from '@/shared/data_processing/trafficController';

export function decryptStreamGCM(input: NodeReadable, password: string) {
  const out = new PassThrough({ highWaterMark: HWM });

  const metaPromise = (async () => {
    const { header, rest } = await readExactlyHeader(input, SALT_LEN + IV_LEN);
    const salt = header.subarray(0, SALT_LEN);
    const iv = header.subarray(SALT_LEN);

    const key = await scryptAsync(password, salt, keyLen, SCRYPT);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });

    // Mantén el tag al final del stream
    const hold = new HoldbackTransform(TAG_LEN);

    // Propaga errores para poder rechazarlos
    const errorPromise = new Promise<never>((_, reject) => {
      hold.once('error', reject);
      decipher.once('error', reject); // ej. "unable to authenticate data"
      out.once('error', reject);
    });

    rest.pipe(hold);
    hold.pipe(decipher, { end: false });
    decipher.pipe(out);

    const tag: Buffer = await new Promise<Buffer>((resolve, reject) => {
      (hold as any).once('trailer', (t: Buffer) => resolve(t));
      hold.once('error', reject);
    });

    // Establecer tag **antes** de finalizar
    decipher.setAuthTag(tag);

    // Finaliza el decipher de forma controlada (puede lanzar si auth falla)
    try {
      decipher.end();
    } catch (e) {
      out.destroy(e as Error);
      throw e;
    }

    // Espera a que termine el flujo o error
    await Promise.race([new Promise<void>((resolve) => out.once('finish', resolve)), errorPromise]);

    return { salt, iv, tag };
  })().catch((err) => {
    out.destroy(err as Error);
    throw err;
  });

  return { output: out, metaPromise };
}

export function encryptStreamGCM(input: NodeReadable, password: string) {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);

  let plainSize = 0;
  const count = new Transform({
    transform(chunk, _enc, cb) {
      plainSize += (chunk as Buffer).length;
      cb(null, chunk);
    }
  });

  const out = new PassThrough({ highWaterMark: HWM });

  const metaPromise = (async () => {
    const key = await scryptAsync(password, salt, keyLen, SCRYPT);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });

    // header
    out.write(salt);
    out.write(iv);

    cipher.pipe(out, { end: false });
    await pipeline(input, count, cipher);

    const tag = cipher.getAuthTag();
    out.end(tag);

    return { size: plainSize, salt, iv, tag };
  })();

  return { output: out, metaPromise };
}

export async function processFileEncryption(fileEntry: FileEntryStream, password: string, zipPackager: ReturnType<typeof createZipPackager>): Promise<FileStatus> {
  try {
    const tappedSource = fileEntry.stream.pipe(tap(`src ${fileEntry.filename}`, 1 * 1024 * 1024));

    const { output, metaPromise } = encryptStreamGCM(tappedSource, password);
    const tappedOutput = output.pipe(tap(`enc ${fileEntry.filename}`, 1 * 1024 * 1024));

    const entryComplete = zipPackager.appendEntryAwait(`${fileEntry.filename}.enc`, tappedOutput);

    const metadata = await metaPromise;
    await entryComplete;

    return {
      file: fileEntry.filename,
      status: 'ok',
      size: metadata.size
    };
  } catch (error: any) {
    return {
      file: fileEntry.filename,
      status: 'error',
      message: error?.message ?? String(error)
    };
  }
}