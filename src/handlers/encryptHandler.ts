import { singleEncryption } from '@/utils/data_processing/encryption';
import { PayloadRequest } from 'payload';
import { fileResponse, handleError } from '@/utils/http/response';

import { isValidUser } from '@/utils/http/auth';
import { getSingleRequestData, PayloadFileRequest } from '@/utils/http/requestProcesses';
import { validateSingleRequest } from '@/utils/http/requestValidator';
import { createEncryptionResult } from '@/controllers/encryptionController';

export const encryptHandler = async (req: PayloadRequest): Promise<Response> => {
  try {
    const errors: Array<string> = [];
    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    // 2️⃣ Multipart → files + CSV
    const { file, password } = await getSingleRequestData(req);

    // 3️⃣ Validaciones: que cada archivo tenga password, etc
    const validRequest = await validateSingleRequest({ file, password }, errors);
    if (validRequest instanceof Response) return validRequest;

    // 4️⃣ Cifrar todos los archivos: devuelve zip y tiempo de procesamiento
    const { fileName, blob, elapsedMs } = file && password ? await singleEncryption(file, password) : { fileName: '', blob: new ArrayBuffer(0), elapsedMs: 0 };

    // 5️⃣ Cifrar todos los archivos: devuelve zip y tiempo de procesamiento
    const docResult = await createEncryptionResult(req, file as PayloadFileRequest, elapsedMs);
    if (docResult instanceof Response) return docResult;

    // 6️⃣ Registrar operación masiva
    return fileResponse(blob, fileName);
  } catch (error: unknown) {
    return handleError(error, 'Error interno del servidor', 'encrypt');
  }
};
