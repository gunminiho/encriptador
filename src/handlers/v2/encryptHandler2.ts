// src/handlers/encryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable, Transform } from 'node:stream';
import { getSingleStreamFromBusboy, parseSingleWithValidationEarly } from '@/utils/http/requestProcesses';
import { encryptStreamGCM } from '@/utils/data_processing/encryption';
import { isValidUser } from '@/utils/http/auth';
import { handleError } from '@/utils/http/response';
//import { validateSingleRequest } from '@/utils/http/requestValidator';

function tap(label: string, step = 5 * 1024 * 1024) {
  let acc = 0;
  return new Transform({
    transform(chunk, _e, cb) {
      acc += chunk.length;
      if (acc >= step) {
        console.log(`[${label}] +${(acc / 1024 / 1024).toFixed(1)} MB`);
        acc = 0;
      }
      cb(null, chunk);
    }
  });
}

export async function encryptSingleStreamHandler(req: PayloadRequest): Promise<Response> {
  const errors: Array<string> = [];
  try {
    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;
    console.log('User is valid:', validUser);

    // 2️⃣ Obtener el stream y la contraseña del request
    const parsed = await parseSingleWithValidationEarly(req, errors);

    // 3️⃣ Validaciones: que cada archivo tenga password, etc
    if (!parsed) return handleError(new Error('Invalid request'), errors, 'Encrypt v2 Endpoint', 400);

    // 4️⃣ Obtener el stream y la contraseña del request
    const { filename, stream, password } = parsed;
    const encName = `${filename}.enc`;

    // en tu handler, antes de encryptStreamGCM:
    const inTapped = stream.pipe(tap('in', 5 * 1024 * 1024));
    // 5️⃣ Cifrar los archivos: devuelve archivo y tiempo de procesamiento
    const { output } = encryptStreamGCM(inTapped, password);
    output.on('end', () => console.log('[out] end'));
    output.on('close', () => console.log('[out] close'));
    output.on('error', (e) => console.error('[out] error', e));
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
    const msg = err?.message ?? 'encrypt_failed';
    return handleError(err, msg, 'Encrypt v2 Endpoint', 500);
  }
}
