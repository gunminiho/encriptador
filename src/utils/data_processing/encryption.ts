// src/services/encryption.ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { performance } from 'perf_hooks';
import type { PayloadFileRequest } from '@/utils/http/requestProcesses';

export interface EncryptionResult {
  fileName: string;
  blob: Uint8Array; // salt|iv|tag|ciphertext
  salt: Uint8Array;
  iv: Uint8Array;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };
export const SALT_LEN: number = 16;
export const IV_LEN: number = 12;
export const TAG_LEN = 16;

async function encryptFileGCM(buffer: ArrayBuffer, password: string, name: string): Promise<EncryptionResult> {
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

export async function decryptFileGCM(buffer: ArrayBuffer, password: string, name: string): Promise<EncryptionResult> {
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

export const massiveEncryption = async (
  dataFiles: Array<PayloadFileRequest>,
  pwMap: Map<string, string>
): Promise<{ zipStream: ReadableStream<Uint8Array>; elapsedMs: number }> => {
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
    const { fileName, blob } = await encryptFileGCM(file.data as unknown as ArrayBuffer, pwd, file.name);
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

export const singleEncryption = async (file: PayloadFileRequest, password: string): Promise<{ fileName: string; blob: ArrayBuffer; elapsedMs: number }> => {
  // 5️⃣ Cifrar archivo y devolver el tiempo de encriptación
  const start = performance.now(); // ⏱️ inicio del cronómetro
  const { fileName, blob } = await encryptFileGCM(file.data as unknown as ArrayBuffer, password, file.name);
  const end = performance.now(); // ⏱️ fin del cronómetro
  const elapsedMs = end - start;

  return { fileName, blob: blob as unknown as ArrayBuffer, elapsedMs };
};
