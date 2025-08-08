import { PayloadRequest, addDataAndFileToRequest } from 'payload';

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
};

export type MassiveEncryptionRequest = {
  csvFile: PayloadFileRequest;
  dataFiles: Array<PayloadFileRequest>;
};

export const getRequestData = async (req: PayloadRequest): Promise<MassiveEncryptionRequest | string> => {
  try {
    //Multipart → files + CSV
    await addDataAndFileToRequest(req);
    //Get the files and CSV from the request
    const allFiles = Array.isArray(req.file) ? req.file : [req.file].filter(Boolean);
    const csvFile = allFiles.find((f) => f.name === 'passwords.csv');
    const dataFiles = allFiles.filter((f) => f.name !== 'passwords.csv');
    const response: MassiveEncryptionRequest = {
      csvFile,
      dataFiles
    };
    return response;
  } catch (error: any) {
    console.error('Hubo un error para esta petición al extraer los archivos desde formData: ' + error.message);
    return 'No se encontró el archivo csv o los archivos de datos, revisar la petición';
  }
};
