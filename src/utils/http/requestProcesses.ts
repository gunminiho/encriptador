import { PayloadRequest, addDataAndFileToRequest } from 'payload';
import Busboy from 'busboy';
import { toNodeReadable } from '../data_processing/converter';

export type PayloadFileRequest = {
  /**
   * Context of the file when it was uploaded via client side.
   */
  clientUploadContext?: unknown;
  data: Buffer;
  mimetype: string;
  name: string;
  size: number;
  tempFilePath?: string;
  fieldName?: string;
};

export type MassiveEncryptionRequest = {
  csvFile: PayloadFileRequest;
  dataFiles: Array<PayloadFileRequest>;
};

export type SingleEncryptionRequest = {
  file?: PayloadFileRequest;
  password?: string;
};

export const getRequestData = async (req: PayloadRequest, errors: Array<string>): Promise<MassiveEncryptionRequest | void> => {
  try {
    //Multipart → files + CSV
    await addDataAndFileToRequest(req);
    //Get the files and CSV from the request
    const allFiles = Array.isArray(req.file) ? req.file : [req.file].filter(Boolean);
    const csvFile = allFiles.find((f) => f.name === 'passwords.csv');
    const dataFiles = allFiles.filter((f) => f.name !== 'passwords.csv');
    if (!csvFile) errors.push('No se encontró passwords.csv');
    const response: MassiveEncryptionRequest = {
      csvFile,
      dataFiles
    };
    return response;
  } catch (error: any) {
    console.error('Hubo un error para esta petición al extraer los archivos desde formData: ' + error.message);
  }
};

export const getSingleRequestData = async (req: PayloadRequest): Promise<SingleEncryptionRequest> => {
  // 1) content-type robusto
  const ct =
    typeof (req as any).headers.get === 'function'
      ? ((req as any).headers.get('content-type') as string | undefined)
      : ((req.headers as any).get['content-type'] as string | undefined);

  if (!ct || !ct.startsWith('multipart/form-data')) {
    throw new Error(`INVALID_CONTENT_TYPE_HEADER: ${ct ?? 'undefined'}`);
  }

  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: { 'content-type': ct },
      limits: { files: 2, fileSize: 20 * 1024 * 1024 } // 20MB
    });

    let password: string | undefined;
    let file_req: PayloadFileRequest | undefined;

    bb.on('field', (name, val) => {
      if (name === 'password') password = val;
    });

    bb.on('file', (name, file, info) => {
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => chunks.push(d));
      file.on('limit', () => reject(new Error('El archivo excede el tamaño permitido')));
      file.on('end', () => {
        const data = Buffer.concat(chunks);
        file_req = {
          fieldName: name,
          name: info.filename,
          mimetype: info.mimeType,
          size: data.length,
          data
        };
      });
    });

    bb.on('close', () => {
      if (!file_req) file_req = undefined;
      if (!password) password = undefined;
      resolve({ file: file_req, password });
    });

    bb.on('error', reject);

    // 2) Conectar el stream según el tipo de request
    toNodeReadable(req).pipe(bb);
  });
};
