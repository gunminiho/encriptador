// src/handlers/decryptSingleStreamHandler.ts
import type { PayloadRequest } from 'payload';
import { Readable } from 'node:stream';
import { getSingleStreamFromBusboy } from '@/utils/http/requestProcesses';
import { decryptStreamGCM } from '@/utils/data_processing/encryption';
import { removeEncExt } from '@/utils/data_processing/converter';

export async function decryptSingleStreamHandler(req: PayloadRequest): Promise<Response> {
  try {
    const { filename, stream, password } = await getSingleStreamFromBusboy(req);
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
