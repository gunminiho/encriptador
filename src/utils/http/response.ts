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

// utils/fileResponse.ts
export function fileResponse(
  binary: Uint8Array | ArrayBuffer,
  filename: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(binary, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}

