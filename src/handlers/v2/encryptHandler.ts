// src/handlers/encryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamAndValidateFromBusboy } from '@/shared/http/requestProcesses';
import { encryptStreamGCM } from '@/shared/data_processing/encryption';
import { isValidUser } from '@/shared/http/auth';
import { handleError, response } from '@/shared/http/response';
import { performance } from 'node:perf_hooks';

import type { PayloadFileRequest } from '@/custom-types';
import { createEncryptionResult } from '@/controllers/encryptionController';

export async function encryptSingleStreamHandlerV2(req: PayloadRequest): Promise<Response> {
  const errors: Array<string> = [];
  try {
    const t0 = performance.now();
    // 1️⃣ Auth
    // const validUser = await isValidUser(req);
    // if (validUser instanceof Response) return validUser;

    // 2️⃣ Obtener el stream, password y hacer validaciones en el proceso
    const validationRules = ['file-type-validation', 'filename-validation', 'password-strength'];
    const { filename, stream, password } = await getSingleStreamAndValidateFromBusboy(req, errors, validationRules);

    // 3️⃣ Verificar si hubo errores durante el parsing/validación
    if (errors.length > 0) return response(400, { error: errors }, 'Bad Request');

    // 4️⃣ Proceder con la encriptación si no hay errores

    const encName = `${filename}.enc`;
    const { output, metaPromise } = encryptStreamGCM(stream, password);

    // ANTES del return, programa el logging del registro:
    metaPromise
      .then(async (meta: { size?: number }) => {
        const elapsedMs = Math.round(performance.now() - t0);

        const ext = (() => {
          const m = /\.([^.]+)$/.exec(filename);
          return m ? m[1].toLowerCase() : undefined;
        })();

        const payloadFile: PayloadFileRequest = {
          name: filename,
          size: Number(meta?.size) || 0,
          ext
          // mimetype: 'application/octet-stream',  // opcional si no lo tienes
        };
        const r = await createEncryptionResult(req, payloadFile, elapsedMs, 'encrypt');
        if (r instanceof Response && !r.ok) {
          console.warn('⚠️  No se pudo registrar la operación (single):', await r.text().catch(() => ''));
        }
      })
      .catch((e) => console.warn('⚠️  metaPromise single encryption:', e));
    // Conversión del stream para la respuesta web
    const nodeOut = output as unknown as NodeJS.ReadableStream;
    const webOut = typeof (Readable as any).toWeb === 'function' ? (Readable as any).toWeb(nodeOut) : (nodeOut as any);

    return new Response(webOut, {
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encName}"; filename*=UTF-8''${encodeURIComponent(encName)}`,
        'Cache-Control': 'private, no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
      })
    });
  } catch (err: any) {
    return handleError(err, 'Error durante la encriptación del archivo', 'encrypt_single_stream');
  }
}
