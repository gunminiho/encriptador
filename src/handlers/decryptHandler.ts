import { decryptFileGCM } from '@/utils/data_processing/encryption';
import { PayloadRequest } from 'payload';
import { response, fileResponse } from '@/utils/http/response';
import { addDataAndFileToRequest } from 'payload';
import type { EncryptionResult } from '@/utils/data_processing/encryption';

import { isValidUser } from '@/utils/http/auth';
import { getSingleRequestData } from '@/utils/http/requestProcesses';
import { validateSingleRequest } from '@/utils/http/requestValidator';

const result: EncryptionResult = {
  fileName: '',
  blob: new Uint8Array(), // aquí iría salt|iv|tag|ciphertext
  salt: new Uint8Array(), // aquí iría el salt
  iv: new Uint8Array() // aquí iría el iv
};

export const decryptHandler = async (req: PayloadRequest): Promise<Response> => {
  const errors: Array<string> = [];
  try {
    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    // 2️⃣ Multipart → files + CSV
    const { file, password } = await getSingleRequestData(req);
    const encFile = file || result;

    // 3️⃣ Validaciones: que cada archivo tenga password, etc
    const validRequest = await validateSingleRequest({ file, password }, errors);
    if (validRequest instanceof Response) return validRequest;

    // --- 4. Desencriptar y responder ---
    const { fileName, blob } = typeof password === 'string' && encFile.data ? await decryptFileGCM(encFile.data, password, encFile.name) : result;
    return fileResponse(blob, fileName);
  } catch (error: any) {
    console.error(error);
    return response(500, { error: `Error interno del servidor: ${error.message}` }, 'Error interno');
  }
};
