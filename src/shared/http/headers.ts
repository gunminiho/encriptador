import { v4 as uuidv4 } from 'uuid';

export function createResponseHeaders(): Headers {
  const filename = `encrypted_${uuidv4()}.zip`;
  const encodedFilename = encodeURIComponent(filename);

  return new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'private, no-store, no-transform',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
  });
}
