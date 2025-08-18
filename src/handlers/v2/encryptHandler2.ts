// src/handlers/encryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamFromBusboy } from '@/utils/http/requestProcesses';
import { encryptStreamGCM } from '@/utils/data_processing/encryption';
import { isValidUser } from '@/utils/http/auth';
import { validateSingleRequest } from '@/utils/http/requestValidator';

export async function encryptSingleStreamHandler(req: PayloadRequest): Promise<Response> {
  try {
    const errors: Array<string> = [];
    // 1️⃣ Auth
    const validUser = await isValidUser(req);
    if (validUser instanceof Response) return validUser;

    // 2️⃣ Obtener el stream y la contraseña del request
    const { filename, stream, password } = await getSingleStreamFromBusboy(req, errors);
    const encName = `${filename}.enc`;

    // // 3️⃣ Validaciones: que cada archivo tenga password, etc
    // const validRequest = await validateSingleRequest({ file, password }, errors);
    // if (validRequest instanceof Response) return validRequest;

    const { output } = encryptStreamGCM(stream, password);
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
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
