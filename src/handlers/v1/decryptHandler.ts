// import type { PayloadRequest } from 'payload';
// import { fileResponse, handleError } from '@/utils/http/response';
// import { isValidUser } from '@/utils/http/auth';
// import { getSingleRequestData } from '@/utils/http/requestProcesses';
// import { validateSingleRequest } from '@/utils/http/requestValidator';
// import { singleDecryption } from '@/utils/data_processing/encryption';

// export const decryptHandler = async (req: PayloadRequest): Promise<Response> => {
//   const errors: Array<string> = [];
//   try {
//     // 1️⃣ Auth.
//     const validUser = await isValidUser(req);
//     if (validUser instanceof Response) return validUser;

//     // 2️⃣ Multipart → files + CSV.
//     const { file, password } = await getSingleRequestData(req);

//     // 3️⃣ Validacion: que el archivo y la contraseña sean válidos.
//     const validRequest = await validateSingleRequest({ file, password }, errors);
//     if (validRequest instanceof Response) return validRequest;

//     // 4️⃣ Descifrar el archivo y devolver el archivo.
//     const { fileName, blob } = singleDecryption(file.data, password, file.name);

//     // 6️⃣ devolver el archivo descifrado.
//     return fileResponse(blob, fileName);
//   } catch (error: unknown) {
//     return handleError(error, 'Error interno del servidor', 'decrypt');
//   }
// };
