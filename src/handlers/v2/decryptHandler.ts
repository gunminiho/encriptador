// src/handlers/decryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamAndValidateFromBusboy } from '@/shared/http/requestProcesses';
import { decryptStreamGCM } from '@/shared/data_processing/encryption';
import { removeEncExt } from '@/shared/data_processing/converter';
import { handleError, response } from '@/shared/http/response';
import { pipeline as nodePipeline } from 'node:stream';
import { createWriteStream, createReadStream, promises as fsp } from 'node:fs';
import path from 'path';
import os from 'os';
import { promisify } from 'node:util';
import { isValidUser } from '@/shared/http/auth';
import { PayloadFileRequest } from '@/custom-types';
import { createEncryptionResult } from '@/controllers/encryptionController';
const pipeline = promisify(nodePipeline);

export async function decryptSingleStreamHandlerV2(req: PayloadRequest): Promise<Response> {
  const errors: Array<string> = [];
  const t0 = performance.now();
  try {
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    const validationRules = ['file-type-validation', 'filename-validation', 'password-strength'];
    const { filename, stream, password } = await getSingleStreamAndValidateFromBusboy(req, errors, validationRules);
    const plainName = removeEncExt(filename);

    if (errors.length > 0) return response(400, { errors }, 'Error en la validacion de los datos');

    // 1) Desencripta a archivo temporal (aún no respondemos al cliente)
    const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tmpDir = path.join(os.tmpdir(), 'payload-encrypt', `dec_${reqId}`);
    await fsp.mkdir(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, plainName);

    const { output, metaPromise } = decryptStreamGCM(stream, password);
    await pipeline(output, createWriteStream(outPath)); // si auth falla, esto rompe

    // 2) Verifica autenticación GCM (si falla, lanza)
    await metaPromise;

    // 2) ✔️ Logea operacion antes del return
    try {
      const st = await fsp.stat(outPath);
      const elapsed_ms = Math.round(performance.now() - t0);

      const ext = (() => {
        const m = /\.([^.]+)$/.exec(plainName);
        return m ? m[1].toLowerCase() : undefined;
      })();

      const payload_file: PayloadFileRequest = {
        name: plainName,
        size: Number(st.size) || 0,
        ext
      };
      const r = await createEncryptionResult(req, payload_file, elapsed_ms, 'decrypt');
      if (r instanceof Response && !r.ok) {
        console.warn('⚠️  No se pudo registrar la operación (decrypt):', await r.text().catch(() => ''));
      }
    } catch (logErr) {
      console.warn('⚠️  Error registrando operación decrypt:', logErr);
    }

    // 3) OK → responde 200 con el archivo y agenda cleanup
    const rs = createReadStream(outPath);
    rs.on('close', () => {
      // cleanup best-effort
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    const webOut = (Readable as any).toWeb ? (Readable as any).toWeb(rs) : (rs as any);

    return new Response(webOut, {
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${plainName}"; filename*=UTF-8''${encodeURIComponent(plainName)}`,
        'Cache-Control': 'private, no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
      })
    });
  } catch (err: unknown) {
    // Mapea claramente el error de autenticación a 400
    const message = err instanceof Error ? err.message : String(err);
    const isAuthErr = /unable to authenticate data|bad decrypt|auth|integrity/i.test(message) || (err as any)?.code === 'ERR_OSSL_EVP_BAD_DECRYPT';

    const status = isAuthErr ? 400 : 500;
    const userMsg = isAuthErr ? 'Contraseña incorrecta o archivo .enc corrupto' : 'Error durante el proceso de desencriptación del archivo';

    return handleError(err, userMsg, 'decrypt_single_stream', status);
  }
}
