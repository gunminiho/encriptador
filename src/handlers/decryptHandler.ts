import { decryptFileGCM } from '@/services/encryption';
import { PayloadRequest } from 'payload';
import { response, fileResponse } from '@/utils/response';
import { addDataAndFileToRequest } from 'payload';
import type { EncryptionResult } from '@/services/encryption';

const result: EncryptionResult = {
  fileName: '',
  blob: new Uint8Array(), // aquí iría salt|iv|tag|ciphertext
  salt: new Uint8Array(), // aquí iría el salt
  iv: new Uint8Array() // aquí iría el iv
};

export const decryptHandler = async (req: PayloadRequest): Promise<Response> => {
  try {
    // --- 1. Autenticación idéntica a /encrypt ---
    const authHeader = req.headers.get('Authorization');
    const isApiKey = typeof authHeader === 'string' && authHeader.includes('API-Key');
    if (!isApiKey || !req.user) {
      return response(401, { error: 'Acceso no autorizado' }, 'Api Key inválida');
    }
    // --- 2. Parsear formData (file + password) ---
    const cloned = req.clone!();
    await addDataAndFileToRequest(req);
    const password: string | FormDataEntryValue | null = (await cloned.formData()).get('password');

    // Extraer el archivo .enc
    let encFile: any;
    console.log('req.file', req.file);
    
    if (Array.isArray(req.file) && req.file.length === 1) {
      encFile = req.file[0];
    } else if (typeof req.file === 'object' && req.file !== null && 'name' in req.file) {
      encFile = req.file;
    }

    // --- 3. Validaciones ---
    const errors: string[] = [];
    if (!encFile) errors.push('No se detectó archivo para desencriptar');
    if (!password || typeof password !== 'string') errors.push('Falta password para desencriptar el archivo');
    if (errors.length > 0) {
      return response(400, errors, 'Error en los parámetros de la solicitud');
    }

    // --- 4. Desencriptar y responder ---
    const { fileName, blob } = typeof password === 'string' && encFile.data ? await decryptFileGCM(encFile.data, password, encFile.name) : result;
    console.log('🔒 decrypted blob length:', blob.byteLength);
    return fileResponse(blob, fileName);
  } catch (error: any) {
    console.error(error);
    return response(500, { error: `Error interno del servidor: ${error.message}` }, 'Error interno');
  }
};
