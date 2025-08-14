import { PayloadRequest, addDataAndFileToRequest } from 'payload';
import Busboy from 'busboy';
import { toNodeReadable } from '../data_processing/converter';
import type { PayloadFileRequest, MassiveEncryptionRequest, SingleEncryptionRequest } from '@/custom-types';

export const getRequestData = async (req: PayloadRequest, errors: Array<string>): Promise<MassiveEncryptionRequest> => {
  try {
    //Multipart → files + CSV
    await addDataAndFileToRequest(req);
    //Get the files and CSV from the request
    const allFiles = Array.isArray(req.file) ? req.file : [req.file].filter(Boolean);
    const csvFile = allFiles.find((f) => f.name === 'passwords.csv');
    const dataFiles = allFiles.filter((f) => f.name !== 'passwords.csv');
    if (!csvFile) errors.push('No se encontró passwords.csv');
    
    return { csvFile, dataFiles };
  } catch (error: unknown) {
    console.error('Hubo un error para esta petición al extraer los archivos desde formData: ' + (error as Error).message);
    throw new Error('Hubo un error para esta petición al extraer los archivos desde formData: ' + (error as Error).message);
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
      limits: { files: 1, fileSize: parseInt(process.env.FILE_SIZE_LIMIT as string) * 1024 * 1024 } // Tamaño definido en .env
    });

    let password: string = '';
    let file_req: PayloadFileRequest = {
      clientUploadContext: undefined,
      data: Buffer.alloc(0),
      mimetype: '',
      name: '',
      size: 0,
      tempFilePath: undefined,
      fieldName: undefined
    };

    bb.on('field', (name, val) => {
      if (name === 'password') password = val;
    });

    bb.on('file', (name, file, info) => {
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => chunks.push(d));
      file.on('limit', () => reject(new Error('El archivo excede el tamaño permitido: ' + process.env.FILE_SIZE_LIMIT + 'MB')));
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
      resolve({ file: file_req, password });
    });

    bb.on('error', reject);

    // 2) Conectar el stream según el tipo de request
    toNodeReadable(req).pipe(bb);
  });
};


