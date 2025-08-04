import { fileTypeFromBuffer } from 'file-type';
import { SALT_LEN, IV_LEN, TAG_LEN } from '@/services/encryption';

import path from 'path';

export async function detectFileTypeFromBlob(
  data: Uint8Array | Buffer<ArrayBufferLike> | undefined,
  fileName: string | undefined
): Promise<{ extension: string; mimeType: string }> {
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
    case 'enc':
      // Validación mínima para un .enc
      if (data && data.byteLength < SALT_LEN + IV_LEN + TAG_LEN) {
        throw new Error('Archivo .enc demasiado pequeño para ser válido');
      }
      return { extension: 'enc', mimeType: 'application/octet-stream' };
    // añade aquí más casos si quieres:
    // case 'html': return { ext: 'html', mime: 'text/html' };
    default:
      break;
  }

  throw new Error('Tipo de archivo desconocido o no soportado');
}
