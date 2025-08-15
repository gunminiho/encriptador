import { fileTypeFromBuffer } from 'file-type';
import {SALT_LEN, IV_LEN, TAG_LEN, EXTENSION_BLACKLIST } from '@/custom-types';
import path from 'path';
//,

async function detectFileTypeFromBlob(data: Uint8Array | Buffer<ArrayBufferLike> | undefined, fileName: string | undefined): Promise<{ extension: string; mimeType: string }> {
  // 1️⃣ Intento magic-number
  const type = data ? await fileTypeFromBuffer(data) : undefined;
  if (type) {
    return {
      extension: type.ext,
      mimeType: type.mime
    };
  }
  // 2️⃣ Fallback por extensión
  const ext = fileName ? path.extname(fileName).slice(1).toLowerCase() : '*.lol';
  switch (ext) {
    case 'txt':
      return { extension: 'txt', mimeType: 'text/plain' };
    case 'csv':
      return { extension: 'csv', mimeType: 'text/csv' };
    case 'svg':
      return { extension: 'svg', mimeType: 'image/svg+xml' };
    case 'xlsx':
      return { extension: 'xlsx', mimeType: 'text/text+xml' };
    case 'enc':
      //Validación mínima para un .enc
      if (data && data.byteLength < SALT_LEN + IV_LEN + TAG_LEN) {
        throw new Error('Archivo .enc demasiado pequeño para ser válido');
      }
      return { extension: 'enc', mimeType: 'application/octet-stream' };
    case 'html':
      return { extension: 'html', mimeType: 'text/html' };
    // añade aquí más casos:
    default:
      return { extension: 'unknown', mimeType: 'text/unknown' };
  }
}

export async function isAllowedFile(
  data: Uint8Array | Buffer<ArrayBufferLike> | undefined,
  fileName: string | undefined
): Promise<{ allowed: boolean; extension: string; mimeType: string }> {
  const { extension, mimeType } = await detectFileTypeFromBlob(data, fileName);
  return { allowed: !EXTENSION_BLACKLIST.has(extension), extension, mimeType };
}
