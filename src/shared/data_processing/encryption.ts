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

  // Error “cripto” que tu handleError reconoce (por 'code')
  const cryptoErr = () => {
    const e = new Error('Contraseña incorrecta o archivo cifrado inválido') as Error & { code?: string; status?: number };
    e.code = 'ERR_OSSL_EVP_BAD_DECRYPT';
    e.status = 422; // si prefieres 400, cámbialo aquí
    return e;
  };

  const metaPromise = (async () => {
    const { header, rest } = await readExactlyHeader(input, SALT_LEN + IV_LEN);
    const salt = header.subarray(0, SALT_LEN);
    const iv = header.subarray(SALT_LEN);

    const key = await scryptAsync(password, salt, keyLen, SCRYPT);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });

    const hold = new HoldbackTransform(TAG_LEN);

    // Solo errores de hold/decipher (auth fallida)
    const errorPromise = new Promise<never>((_, reject) => {
      const r = () => reject(cryptoErr());
      hold.once('error', r);
      decipher.once('error', r); // "unable to authenticate data", etc.
      // NO escuchar 'out.error' para que destroy(e) no rebote otro rechazo
    });
    (errorPromise as Promise<never>).catch(() => {
      /* swallow to avoid unhandledRejection */
    });

    rest.pipe(hold);
    hold.pipe(decipher, { end: false });
    decipher.pipe(out);

    const tag: Buffer = await new Promise<Buffer>((resolve, reject) => {
      (hold as any).once('trailer', (t: Buffer) => resolve(t));
      hold.once('error', () => reject(cryptoErr()));
    });

    decipher.setAuthTag(tag);

    try {
      decipher.end(); // puede lanzar si GCM falla
    } catch {
      const e = cryptoErr();
      out.destroy(e); // propaga error "cripto" al pipeline (no "Premature close")
      throw e; // rechaza metaPromise con el mismo error
    }

    await Promise.race([new Promise<void>((resolve) => out.once('finish', resolve)), errorPromise]);

    return { salt, iv, tag };
  })().catch((_err) => {
    const e = cryptoErr();
    if (!out.destroyed) out.destroy(e); // idem: error "cripto" al pipeline
    throw e; // metaPromise queda rejected con el mismo error
  });

  // 👇👇 **Línea clave para silenciar el "unhandledRejection"**
  void (metaPromise as Promise<unknown>).catch(() => {});

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
