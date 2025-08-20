// Massive Encryption Handler V2 con limpieza de archivos temporales
import { PayloadRequest } from 'payload';
import { isValidUser } from '@/shared/http/auth';
import { parseMassiveEncryptionRequest } from '@/shared/http/requestProcesses';
import { validateMassiveEncryptionRequest } from '@/shared/http/requestValidator';
import { cleanupRequestDirectory } from '@/shared/data_processing/cleaningTempFiles';
import { createMassiveEncryptionPipeline } from '@/shared/data_processing/trafficController';
import { createResponseHeaders } from '@/shared/http/headers';
import { handleError } from '@/shared/http/response';
import { ParsedMassiveRequest, PayloadFileRequest } from '@/custom-types';
import { response } from '@/shared/http/response';
import { performance } from 'node:perf_hooks';
import { createEncryptionResult } from '@/controllers/encryptionController';

export async function massiveEncryptionHandlerV2(req: PayloadRequest): Promise<Response> {
  const errors: string[] = [];
  let parsedData: ParsedMassiveRequest | null = null;
  const t0 = performance.now();
  try {
    // 1️⃣ Autenticación
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    const ok_files: Array<PayloadFileRequest> = [];
    // 2️⃣ Parsing del request (con límites estrictos)
    parsedData = await parseMassiveEncryptionRequest(req, errors);
    //console.log(`📊 Parsing completado: ${parsedData.totalFiles} archivos, ${(parsedData.totalSizeBytes / (1024 * 1024)).toFixed(2)}MB total`);
    // 3️⃣ Validación completa
    const validationResult = await validateMassiveEncryptionRequest(parsedData, errors);

    if (!validationResult.isValid) {
      //console.warn(`❌ Validación fallida: ${validationResult.errors.length} errores`);

      return response(
        400,
        {
          errors: validationResult.errors,
          stats: {
            filesProcessed: parsedData.totalFiles,
            totalSizeMB: (parsedData.totalSizeBytes / (1024 * 1024)).toFixed(2)
          }
        },
        'Error en la validación de archivos para encriptación masiva'
      );
    }
    // 🔧 Construir pipeline (ahora devuelve `done`)
    const { webStream, stop, done } = await createMassiveEncryptionPipeline(parsedData, {
      on_file_ok: ({ name, size, ext, mimetype }) => {
        ok_files.push({ name, size: Number(size) || 0, ext, mimetype });
      }
    });

    // 5) Programa el logging al cierre del ZIP (no bloquea)
    done
      .then(async () => {
        const elapsedMs = Math.round(performance.now() - t0);
        if (ok_files.length > 0) {
          const r = await createEncryptionResult(req, ok_files, elapsedMs, 'encrypt');
          if (r instanceof Response && !r.ok) {
            console.warn('⚠️  No se pudo registrar la operación (massive):', await r.text().catch(() => ''));
          }
        }
      })
      .catch((e) => console.warn('⚠️  massive logging error:', e));

    // 5️⃣ Retornar response con el ZIP stream
    const successResponse = new Response(webStream, {
      headers: createResponseHeaders()
    });

    // 📝 Log de éxito
    // console.log(`🎉 Encriptación masiva iniciada exitosamente: ${parsedData.totalFiles} archivos, ${(parsedData.totalSizeBytes / (1024 * 1024)).toFixed(2)}MB`);
    return successResponse;
  } catch (error: any) {
    console.error('💥 Error en handler de encriptación masiva:', error);
    return handleError(error, 'Error durante la encriptación masiva', 'massive_encryption');
  } finally {
    // ⚡ LIMPIEZA MEJORADA - Solo borrar la carpeta completa
    if (parsedData?.tempDir) {
      //console.log('🧹 Limpiando archivos temporales...');
      await cleanupRequestDirectory(parsedData.tempDir);
    }
  }
}
