// src/handlers/decryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamFromBusboy, parseSingleWithValidationEarly } from '@/utils/http/requestProcesses';
import { decryptStreamGCM } from '@/utils/data_processing/encryption';
import { removeEncExt } from '@/utils/data_processing/converter';
import { isValidUser } from '@/utils/http/auth';
import { handleError } from '@/utils/http/response';

export async function decryptSingleStreamHandler(req: PayloadRequest): Promise<Response> {
  const errors: Array<string> = [];
  try {
    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;
    //console.log('User is valid:', validUser);

    // 2️⃣ Obtener el stream y la contraseña del request
    const parsed = await parseSingleWithValidationEarly(req, errors);

    // 3️⃣ Validaciones: que cada archivo tenga password, etc
    if (!parsed) return handleError(new Error('Invalid request'), errors, 'Encrypt v2 Endpoint', 400);

    // 4️⃣ Obtener el stream y la contraseña del request
    const { filename, stream, password } = parsed;
    const plainName = removeEncExt(filename);

    const { output } = decryptStreamGCM(stream as Readable, password);
    const nodeOut = output as unknown as NodeJS.ReadableStream;
    const webOut = typeof (Readable as any).toWeb === 'function' ? (Readable as any).toWeb(nodeOut) : (nodeOut as any);

    return new Response(webOut, {
      headers: new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${plainName}"; filename*=UTF-8''${encodeURIComponent(plainName)}`,
        'Cache-Control': 'private, no-store, no-transform',
        //'Content-Length': size as unknown as string,
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
      })
    });
  } catch (err: any) {
    const msg = err?.message ?? 'decrypt_failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
