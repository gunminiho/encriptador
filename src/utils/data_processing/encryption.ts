// src/services/encryption.ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { performance } from 'perf_hooks';
import {
  PayloadFileRequest,
  EncryptionResult,
  DecryptionResult,
  HWM,
  keyLen,
  SCRYPT,
  SALT_LEN,
  IV_LEN,
  TAG_LEN,
  MassiveEncryptionResult,
  FileStatus,
  FileEntryStream
} from '@/custom-types';
import { toArrayBuffer } from './converter';
import { readExactlyHeader, HoldbackTransform } from './validator';
import { type Readable as NodeReadable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { scryptAsync } from '@/utils/data_processing/trafficController';
import { createZipPackager } from './zipper';
import { tap } from '@/utils/data_processing/trafficController';

function encryptFileGCM(buffer: ArrayBuffer, password: string, name: string): EncryptionResult {
  // 1️⃣ Derivar clave
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, keyLen, SCRYPT);

  // 2️⃣ Cifar archivo
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(buffer)), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = Buffer.concat([salt, iv, tag, ciphertext]);
  return { fileName: `${name}.enc`, blob, salt, iv };
}

function decryptFileGCM(buffer: ArrayBuffer, password: string, name: string): EncryptionResult {
  // 1. Reconstituir Buffer
  const buf = Buffer.from(buffer);

  // 2. Extraer salt, iv, tag y ciphertext
  const salt = buf.slice(0, SALT_LEN);
  const iv = buf.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.slice(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = buf.slice(SALT_LEN + IV_LEN + TAG_LEN);

  // 3. Derivar key
  const key = scryptSync(password, salt, keyLen, SCRYPT);

  // 4. Desencriptar
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // 5. Nombre original (quitamos “.enc”)
  const originalName = name.replace(/\.enc$/, '') || name;

  return {
    fileName: originalName,
    blob: new Uint8Array(plaintext),
    salt,
    iv
  };
}

export const massiveEncryption = async (dataFiles: Array<PayloadFileRequest>, pwMap: Map<string, string>): Promise<MassiveEncryptionResult> => {
  // 5️⃣ Cifrar todos y enviar zip
  const start = performance.now(); // ⏱️ inicio del cronómetro
  const zipStream = new PassThrough(); // stream de salida
  const archive = archiver('zip', { zlib: { level: 9 } }); // archivo zip y compresión
  archive.pipe(zipStream); // conecta zip al stream

  const totalFiles = dataFiles.length;
  console.log(`🔐 Archivos a encriptar: ${totalFiles}`);
  for (let i = 0; i < totalFiles; i++) {
    const file = dataFiles[i];
    const pwd = (pwMap as Map<string, string>).get(file.name)!;
    const { fileName, blob } = encryptFileGCM(file.data as unknown as ArrayBuffer, pwd, file.name);
    const percent = ((i + 1) / totalFiles) * 100;
    const percentFormatted = percent.toFixed(2).padStart(6, ' ');
    process.stdout.write(`\r🛠️ Encriptando ${i + 1} de ${totalFiles} | Completado: ${percentFormatted}%`);
    if (!Buffer.isBuffer(blob)) {
      throw new Error(`encryptFileGCM no devolvió un Buffer válido para ${file.name}`);
    }
    archive.append(blob, { name: fileName });
  }
  const end = performance.now(); // ⏱️ fin del cronómetro
  const elapsedMs = end - start;
  console.log(`\n✅ Encriptación completada en ${(elapsedMs / 1000).toFixed(2)} segundos.`);
  // Finaliza el zip
  archive.finalize();
  return { zipStream: zipStream as unknown as ReadableStream<Uint8Array>, elapsedMs };
};

export const singleEncryption = (file: PayloadFileRequest, password: string): DecryptionResult => {
  // 5️⃣ Cifrar archivo y devolver el tiempo de encriptación
  const start = performance.now(); // ⏱️ inicio del cronómetro
  const arrayBuffer = toArrayBuffer(file.data);
  process.stdout.write(`\r🛠️ Encriptando ${file.name} con ${password} | %`);
  const { fileName, blob } = encryptFileGCM(arrayBuffer, password, file.name);
  const end = performance.now(); // ⏱️ fin del cronómetro
  const elapsedMs = end - start;
  console.log(`\n✅ Encriptación completada en ${(elapsedMs / 1000).toFixed(2)} segundos.`);

  return { fileName, blob: blob as unknown as ArrayBuffer, elapsedMs };
};

export const singleDecryption = (file: ArrayBuffer | Buffer<ArrayBufferLike>, password: string | undefined, name: string): EncryptionResult => {
  const arrayBuffer = toArrayBuffer(file);
  const { fileName, blob } = decryptFileGCM(arrayBuffer, password!, name);
  return { fileName, blob };
};

export function decryptStreamGCM(input: NodeReadable, password: string) {
  const out = new PassThrough({ highWaterMark: HWM });

  const metaPromise = (async () => {
    // 1) leer [salt+iv]
    const { header, rest } = await readExactlyHeader(input, SALT_LEN + IV_LEN);
    const salt = header.subarray(0, SALT_LEN);
    const iv = header.subarray(SALT_LEN);

    // 2) clave
    const key = await scryptAsync(password, salt, keyLen, SCRYPT);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });

    // 3) retén el tag final
    const hold = new HoldbackTransform(TAG_LEN);

    rest.pipe(hold);
    hold.pipe(decipher, { end: false });
    decipher.pipe(out);

    const tag: Buffer = await new Promise((resolve, reject) => {
      (hold as any).once('trailer', (t: Buffer) => resolve(t));
      hold.once('error', reject);
    });

    decipher.setAuthTag(tag);
    decipher.end();

    return { salt, iv, tag };
  })().catch((err) => {
    out.destroy(err);
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
