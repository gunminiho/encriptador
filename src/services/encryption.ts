// src/services/encryption.ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
export interface EncryptionResult {
  fileName: string;
  blob: Uint8Array; // salt|iv|tag|ciphertext
  salt: Uint8Array;
  iv: Uint8Array;
  fileType?: string;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLen: 32, maxmem: 64 * 1024 * 1024 };
export const SALT_LEN: number = 16;
export const IV_LEN: number = 12;
export const TAG_LEN = 16;

export async function encryptFileGCM(buffer: ArrayBuffer, password: string, name: string): Promise<EncryptionResult> {
  // 1️⃣ Derivar clave
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);

  // 2️⃣ Cifar archivo
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(buffer)), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = Buffer.concat([salt, iv, tag, ciphertext]);
  return { fileName: `${name}.enc`, blob: blob, salt, iv };
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
