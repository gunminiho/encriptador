// // src/collections/EncryptionOperations.ts
// import type { PayloadRequest } from 'payload';
// import { v4 as uuidv4 } from 'uuid';
// import { massiveEncryption } from '@/utils/data_processing/encryption';
// import { streamFileResponse, handleError } from '@/utils/http/response';
// import { isValidUser } from '@/utils/http/auth';
// import { getRequestData } from '@/utils/http/requestProcesses';
// import { csvParser } from '@/utils/data_processing/csvParser';
// import { validateMassiveRequest } from '@/utils/http/requestValidator';
// import { createEncryptionResult } from '@/controllers/encryptionController';

// export const massiveEncryptionHandler = async (req: PayloadRequest): Promise<Response> => {
//   const errors: Array<string> = [];
//   try {
//     // 1️⃣ Auth
//     const validUser = await isValidUser(req);
//     if (validUser instanceof Response) return validUser;

//     // 2️⃣ Multipart → files + CSV
//     const { csvFile, dataFiles } = await getRequestData(req, errors);

//     // 3️⃣ Parsear CSV en un Map<fileName,password>
//     const pwMap = csvParser(csvFile) ?? new Map<string, string>();

//     // 4️⃣ Validaciones: que cada archivo tenga password, etc
//     const validateResponse = await validateMassiveRequest({ csvFile, dataFiles }, pwMap, errors);
//     if (validateResponse instanceof Response) return validateResponse;

//     // 5️⃣ Cifrar todos los archivos: devuelve zip y tiempo de procesamiento
//     const { zipStream, elapsedMs } = await massiveEncryption(dataFiles, pwMap);

//     // 6️⃣ Registrar operación masiva
//     await createEncryptionResult(req, dataFiles, elapsedMs);

//     // 7️⃣ Responder application/octet-stream : application/zip
//     return streamFileResponse(zipStream, `encrypted_${uuidv4()}.zip`, `application/zip`);
//   } catch (err: unknown) {
//     return handleError(err, 'Error en la encriptación masiva', 'massive-encrypt', 500);
//   }
// };
