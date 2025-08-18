// // ============================================================================
// //  MAIN HANDLER - Single Responsibility: Coordinar flujo principal
// // ============================================================================
// import { PayloadRequest } from 'payload';
// import { isValidUser } from '@/utils/http/auth';
// import { parseMassiveEncryptionRequest } from '@/utils/http/requestProcesses';
// import { validateMassiveEncryptionRequest } from '@/utils/http/requestValidator';
// import { cleanupTemporaryFiles } from '@/utils/data_processing/cleaningTempFiles';
// import { createMassiveEncryptionPipeline } from '@/utils/data_processing/trafficController';
// import { createResponseHeaders } from '@/utils/http/headers';
// import { handleError, response } from '@/utils/http/response';

// export async function massiveEncryptionHandlerV2(req: PayloadRequest): Promise<Response> {
//   const errors: Array<string> = [];
//   try {
//     // 1️⃣ Autenticación
//     const validUser = await isValidUser(req);
//     if (validUser instanceof Response) return validUser;

//     // 2️⃣ Parsing del request
//     const parsedData = await parseMassiveEncryptionRequest(req, errors);

//     // 3️⃣ Validación completa
//     const validationResult = await validateMassiveEncryptionRequest(parsedData, errors);

//     if (!validationResult.isValid) {
//       // Limpiar archivos temporales si hay errores y devolver respuesta de error
//       await cleanupTemporaryFiles(parsedData.fileList);
//       return response(400, { errors: errors }, 'Bad Request');
//     }
//     // 4️⃣ Procesar encriptación (solo si es válido)
//     const { webStream } = await createMassiveEncryptionPipeline(parsedData);

//     // 5️⃣ Retornar response con el ZIP stream
//     return new Response(webStream, {
//       headers: createResponseHeaders()
//     });
//   } catch (error: any) {
//     console.log('errorr');
//     return handleError(error, 'Error durante la encriptación masiva', 'massive_encryption');
//   }
// }

// ============================================================================
// HANDLER PRINCIPAL CON LIMPIEZA MEJORADA
// ============================================================================

import { PayloadRequest } from 'payload';
import { isValidUser } from '@/utils/http/auth';
import { parseMassiveEncryptionRequest } from '@/utils/http/requestProcesses';
import { validateMassiveEncryptionRequest } from '@/utils/http/requestValidator';
import { cleanupRequestDirectory } from '@/utils/data_processing/cleaningTempFiles';
import { createMassiveEncryptionPipeline } from '@/utils/data_processing/trafficController';
import { createResponseHeaders } from '@/utils/http/headers';
import { handleError } from '@/utils/http/response';
import { ParsedMassiveRequest } from '@/custom-types';

export async function massiveEncryptionHandlerV2(req: PayloadRequest): Promise<Response> {
  const errors: string[] = [];
  let parsedData: ParsedMassiveRequest | null = null;

  try {
    // 1️⃣ Autenticación
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    // 2️⃣ Parsing del request (con límites estrictos)
    console.log('🚀 Iniciando parsing de request masivo...');
    parsedData = await parseMassiveEncryptionRequest(req, errors);

    console.log(`📊 Parsing completado: ${parsedData.totalFiles} archivos, ${(parsedData.totalSizeBytes / (1024 * 1024)).toFixed(2)}MB total`);

    // 3️⃣ Validación completa
    console.log('🔍 Validando archivos...');
    const validationResult = await validateMassiveEncryptionRequest(parsedData, errors);

    if (!validationResult.isValid) {
      console.warn(`❌ Validación fallida: ${validationResult.errors.length} errores`);

      // ⚡ LIMPIEZA MEJORADA - Solo borrar la carpeta completa
      await cleanupRequestDirectory(parsedData.tempDir);

      return new Response(
        JSON.stringify({
          error: 'Error en la validación de archivos para encriptación masiva',
          details: validationResult.errors,
          stats: {
            filesProcessed: parsedData.totalFiles,
            totalSizeMB: (parsedData.totalSizeBytes / (1024 * 1024)).toFixed(2)
          }
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('✅ Validación exitosa, iniciando encriptación...');

    // 4️⃣ Procesar encriptación (solo si es válido)
    const { webStream, stop } = await createMassiveEncryptionPipeline(parsedData);

    // 5️⃣ Retornar response con el ZIP stream
    const response = new Response(webStream, {
      headers: createResponseHeaders()
    });

    // 📝 Log de éxito
    console.log(`🎉 Encriptación masiva iniciada exitosamente: ${parsedData.totalFiles} archivos, ${(parsedData.totalSizeBytes / (1024 * 1024)).toFixed(2)}MB`);

    return response;
  } catch (error: any) {
    console.error('💥 Error en handler de encriptación masiva:', error);

    // ⚡ LIMPIEZA EN CASO DE ERROR CRÍTICO
    if (parsedData?.tempDir) {
      console.log('🧹 Limpiando archivos por error crítico...');
      await cleanupRequestDirectory(parsedData.tempDir);
    }

    return handleError(error, 'Error durante la encriptación masiva', 'massive_encryption');
  }
}
