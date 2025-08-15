// src/services/encryption.ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { performance } from 'perf_hooks';
import { PayloadFileRequest, EncryptionResult, DecryptionResult, SCRYPT, SALT_LEN, IV_LEN, TAG_LEN, MassiveEncryptionResult } from '@/custom-types';
import { toArrayBuffer } from './converter';

function encryptFileGCM(buffer: ArrayBuffer, password: string, name: string): EncryptionResult {
  // 1️⃣ Derivar clave
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);

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
  const key = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);

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

export function decryptFileGCMv2(buffer: ArrayBuffer, password: string, name: string) {
  const buf = Buffer.from(buffer);
  if (buf.length < SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error(`enc_too_short:${buf.length}`);
  }

  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);

  const key = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);

  // Intento A: formato streaming [salt][iv][ciphertext][tag]
  const trailerTag = buf.subarray(buf.length - TAG_LEN);
  const trailerCipher = buf.subarray(SALT_LEN + IV_LEN, buf.length - TAG_LEN);

  const tryTrailer = () => {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(trailerTag);
    return Buffer.concat([d.update(trailerCipher), d.final()]);
  };

  // Intento B: formato antiguo [salt][iv][tag][ciphertext]
  const headerTag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const headerCipher = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const tryHeader = () => {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(headerTag);
    return Buffer.concat([d.update(headerCipher), d.final()]);
  };

  let plain: Buffer | null = null;
  try {
    plain = tryTrailer();
  } catch (e1) {
    try {
      plain = tryHeader();
    } catch (e2) {
      // Logs útiles para depurar
      const dbg = {
        total: buf.length,
        saltHex: salt.toString('hex'),
        ivHex: iv.toString('hex'),
        tagTrailerHex: trailerTag.toString('hex').slice(0, 16) + '…',
        tagHeaderHex: headerTag.toString('hex').slice(0, 16) + '…',
        scrypt: SCRYPT
      };
      console.error('[decrypt] auth_failed', dbg);
      // Mensaje claro para el cliente
      const err = new Error('auth_failed: wrong password or corrupted/unsupported .enc');
      (err as any).debug = dbg;
      throw err;
    }
  }

  const originalName = name.replace(/\.enc$/i, '') || name;
  return { fileName: originalName, blob: new Uint8Array(plain!), salt, iv };
}

// Wrapper idéntico al tuyo
export const singleDecryptionv2 = (file: ArrayBuffer | Buffer<ArrayBufferLike>, password: string | undefined, name: string) => {
  const ab = toArrayBuffer(file);
  return decryptFileGCMv2(ab, password!, name);
};
