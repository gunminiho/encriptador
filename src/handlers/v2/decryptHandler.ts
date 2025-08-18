// src/handlers/decryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamAndValidateFromBusboy } from '@/utils/http/requestProcesses';
import { decryptStreamGCM } from '@/utils/data_processing/encryption';
import { removeEncExt } from '@/utils/data_processing/converter';

export async function decryptSingleStreamHandlerV2(req: PayloadRequest): Promise<Response> {
  const errors: Array<string> = [];
  try {
    // 2️⃣ Obtener el stream, password y hacer validaciones en el proceso
    const validationRules = [
      'file-type-validation', // Validar tipo de archivo
      'filename-validation', // Validar nombre de archivo
      'password-strength' // Validar fortaleza de contraseña
    ];
    const { filename, stream, password } = await getSingleStreamAndValidateFromBusboy(req, errors, validationRules);
    const plainName = removeEncExt(filename);

    const { output } = decryptStreamGCM(stream, password);
    const nodeOut = output as unknown as NodeJS.ReadableStream;
    const webOut = typeof (Readable as any).toWeb === 'function' ? (Readable as any).toWeb(nodeOut) : (nodeOut as any);

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
  } catch (err: any) {
    const msg = err?.message ?? 'decrypt_failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
