import type { BinaryLike } from '@/custom-types';
import { toError } from '../data_processing/converter';

export function response(status: number, data?: unknown, message?: string, headers?: Record<string, string>): Response {
  let normalizedData = data;

  // Si data es boolean, se queda igual (true o false)
  if (typeof data === 'boolean') {
    // no cambiamos nada
  }
  // Si data es string, lo metemos en array de strings
  else if (typeof data === 'string') {
    normalizedData = [data];
  }
  // Si data es array de strings, lo dejamos igual
  else if (Array.isArray(data) && data.every((item) => typeof item === 'string')) {
    // lo dejamos igual
  }
  // Si es undefined o null, lo dejamos como null
  else if (data === undefined || data === null) {
    normalizedData = null;
  }
  // Para todo lo demás (objetos, arrays de objetos, numbers, etc.), lo dejamos igual

  const body = JSON.stringify({
    message: message || '',
    data: normalizedData
  });

  const allHeaders = {
    'Content-Type': 'application/json',
    ...(headers || {})
  };

  return new Response(body, { status, headers: allHeaders });
}

function contentDispositionAttachment(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function fileResponse(binary: BinaryLike, filename: string, extraHeaders: Record<string, string> = {}): Response {
  // ⚠️ No importes BodyInit: usa el global
  const body: BinaryLike =
    binary instanceof Blob
      ? binary
      : binary instanceof ReadableStream
        ? binary
        : ArrayBuffer.isView(binary)
          ? binary
          : binary instanceof ArrayBuffer
            ? binary
            : new Uint8Array(binary as ArrayBuffer);

  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDispositionAttachment(filename),
      ...extraHeaders
    }
  });
}

export function streamFileResponse(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  contentType = 'application/octet-stream',
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // RFC 5987: soporta nombres con UTF-8 + fallback ASCII
      'Content-Disposition': contentDispositionAttachment(filename),
      ...extraHeaders
    }
  });
}

export function handleError(e: unknown, responseMessage: string, endpoint: string, status = 500): Response {
  const err = toError(e);
  const message = err instanceof Error ? err.message : String(err);
  const isCryptoErr = /unable to authenticate data|bad decrypt|auth|integrity/i.test(message) || (err as any)?.code === 'ERR_OSSL_EVP_BAD_DECRYPT';
  // Log estructurado (solo servidor)
  
  const error = err.stack?.split('\n');
  if (!isCryptoErr) {
    console.log(`[endpoint:${endpoint}] ERROR:`, { error: error?.at(0), stack: error?.slice(1, 7).join('\n') });
  }

  // Respuesta estándar al cliente (no filtrar stack)
  return response(
    status === 500 ? 500 : isCryptoErr ? 422 : status,
    { error: responseMessage },
    status === 500 ? 'Internal Server Error' : isCryptoErr ? 'Unprocessable Entity' : 'Request Error'
  );
}
