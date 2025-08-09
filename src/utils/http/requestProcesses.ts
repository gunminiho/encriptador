import { PayloadRequest, addDataAndFileToRequest } from 'payload';
import Busboy from 'busboy';
import { Readable } from 'stream';

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
  file: PayloadFileRequest;
  password: string;
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

// export const getSingleRequestData = async (req: PayloadRequest, errors?: Array<string>): Promise<SingleEncryptionRequest> => {
//   //const cloned = typeof req.clone === 'function' ? req.clone() : req;
//   //await addDataAndFileToRequest(req);
//   //const password: FormData = await cloned.formData();
//   // 1) content-type robusto
//   //const ct = req.headers ? ((req as any).get('Content-Type') as string | undefined) : ((req.headers as any)['content-type'] as string | undefined);

//   // if (!ct || !ct.startsWith('multipart/form-data')) {
//   //   console.log('CT:', ct);
//   //   throw new Error(`INVALID_CONTENT_TYPE: ${ct ?? 'undefined'}`);
//   // }
//   console.log('1');

//   return new Promise((resolve, reject) => {
//     const bb = Busboy({
//       headers: { 'content-type': req.headers.get('Content-Type') as string },
//       limits: { files: 1, fileSize: 150 * 1024 * 1024 } // 100MB ejemplo
//     });
//     console.log('2');
//     let password: string;
//     let fileReq: PayloadFileRequest;

//     bb.on('field', (name, val) => {
//       console.log('3');
//       if (name === 'password') password = val;
//     });

//     bb.on('file', (name, file, info) => {
//       console.log('4');
//       const chunk: Array<Buffer> = [];
//       file.on('data', (d: Buffer) => {
//         console.log('5');
//         chunk.push(d);
//       });
//       //file.on('limit', () => reject(new Error('FILE_TOO_LARGE')));
//       file.on('end', () => {
//         console.log('6');
//         const data = Buffer.concat(chunk);
//         fileReq = {
//           fieldName: name,
//           name: info.filename,
//           mimetype: info.mimeType,
//           size: data.length,
//           data
//         };
//       });
//     });

//     bb.on('close', () => {
//       if (!fileReq) return reject(new Error('MISSING_FILE'));
//       if (!password) return reject(new Error('MISSING_PASSWORD'));
//       resolve({ file: fileReq, password });
//     });

//     bb.on('error', reject);
//     console.log('password:', password);
//     console.log('file:', fileReq);

//     // 2) ¡IMPORTANTE!: conectar el stream
//     (req as any).pipe(bb);

//     //const file: PayloadFileRequest = (await cloned.formData()).get('file');
//     //let passwords: any = null;
//     //console.log('filecito:', file);

//     //let files: any = null;
//   });
// };

export const getSingleRequestData = async (req: PayloadRequest, _errors?: string[]): Promise<SingleEncryptionRequest> => {
  // 1) content-type robusto
  const ct = typeof (req as any).get === 'function' ? ((req as any).get('content-type') as string | undefined) : ((req.headers as any)['content-type'] as string | undefined);

  // if (!ct || !ct.startsWith('multipart/form-data')) {
  //   throw new Error(`INVALID_CONTENT_TYPE: ${ct ?? 'undefined'}`);
  // }

  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: { 'content-type': req.headers.get('Content-Type') as string },
      limits: { files: 1, fileSize: 150 * 1024 * 1024 } // 150MB
    });

    let password: string | undefined;
    let file_req: PayloadFileRequest | undefined;

    bb.on('field', (name, val) => {
      if (name === 'password') password = val;
    });

    bb.on('file', (name, file, info) => {
      const chunks: Buffer[] = [];
      file.on('data', (d: Buffer) => chunks.push(d));
      file.on('limit', () => reject(new Error('FILE_TOO_LARGE')));
      file.on('end', () => {
        const data = Buffer.concat(chunks);
        file_req = {
          fieldName: name,
          name: info.filename,
          mimetype: info.mimeType,
          size: data.length,
          data,
        };
      });
    });

    bb.on('close', () => {
      if (!file_req) return reject(new Error('MISSING_FILE'));
      if (!password) return reject(new Error('MISSING_PASSWORD'));
      resolve({ file: file_req, password });
    });

    bb.on('error', reject);

    // 2) Conectar el stream según el tipo de request
    const maybeNodeReq: any = req as any;
    if (typeof maybeNodeReq.pipe === 'function') {
      // Express/Node
      maybeNodeReq.pipe(bb);
    } else if (maybeNodeReq.body && typeof maybeNodeReq.body.getReader === 'function') {
      // Fetch Request (ReadableStream)
      Readable.fromWeb(maybeNodeReq.body as unknown as ReadableStream<Uint8Array>).pipe(bb);
    } else {
      reject(new Error('UNSUPPORTED_REQUEST_TYPE'));
    }
  });
}
