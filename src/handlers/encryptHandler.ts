import { encryptFileGCM } from '@/services/encryption';
import { PayloadRequest } from 'payload';
import { response, fileResponse } from '@/utils/response';
import { addDataAndFileToRequest } from 'payload';
import type { EncryptionOperation } from '@/payload-types';
import { detectFileTypeFromBlob } from '@/utils/fileChecker';

export const encryptHandler = async (req: PayloadRequest): Promise<Response> => {
  try {
    // 1. Autenticación
    const authHeader = req.headers.get('Authorization');
    const isApiKey = typeof authHeader === 'string' && authHeader.includes('API-Key');
    if (!isApiKey || !req.user) return response(401, { error: 'Acceso no autorizado' }, 'Api Key invalida');
    let cloned: Request | null = null;
    let password: string | FormDataEntryValue | null = null;
    let passwords: any = null;
    let files: any = null;
    const errors: Array<string> = [];

    // 2. Parsear multipart (1 archivo + password)
    if (typeof req.clone === 'function') {
      cloned = req.clone();
      await addDataAndFileToRequest(req);
      password = (await cloned.formData()).get('password');
      if (Array.isArray(req.file) && req.file.length > 3) files = req.file.filter((file) => file.name !== 'passwords.csv');
      else if (typeof req.file === 'object' && req.file !== null && req.file.name !== 'passwords.csv') files = req.file;
      passwords = Array.isArray(req.file) && req.file.some((file) => file.name === 'passwords.csv') ? req.file.filter((file) => file.name === 'passwords.csv') : null;
      // console.log('---------');
      //console.log('password:', passwords);
      // console.log('files:', files ? files.length : null);
      // console.log('passwords:', passwords ? passwords.length : null);
      // console.log('---------');

      // --- Validaciones ---
      const { extension, mimeType } = await detectFileTypeFromBlob(req.file?.data, req.file?.name);
      console.log('mime:', extension, mimeType);

      if ((Array.isArray(files) && files.length < 1) || !files) errors.push('No se detectaron archivos para encriptar');
      if (password && Array.isArray(files) && files.length < 1) errors.push('No se detecto archivo para encriptar con esta contraseña');
      if (!password && Array.isArray(files) && files.length === 1) errors.push('No se detecto password para encriptar un solo archivo');
      if (passwords && Array.isArray(files) && files.length === 1) errors.push('Solo se detecto el archivo de configuración csv para encriptación masiva');
      if (passwords && Array.isArray(files) && files.length === 2)
        errors.push('Se detecto un solo archivo para encriptar y un archivo de configuración csv para encriptación masiva');
      if (!passwords && Array.isArray(files) && files.length > 2) errors.push('No se detecto archivo de passwords para encriptar varios archivos');
      if (password && passwords) errors.push('Se detecto password individual y archivo de configuración csv para encriptación masiva');
      if (errors.length > 0) return response(400, errors, 'Error en los parámetros de la solicitud');
      // -------------------
      // 3. Cifrar
      const start = Date.now();
      if (!Array.isArray(files) && typeof password === 'string') {
        const { fileName, blob, fileType } = await encryptFileGCM(files.data, password, files.name);
        const elapsed = Date.now() - start;
        const encrypt_result: EncryptionOperation = {
          tenant_id: req.user.id,
          operation_type: 'encrypt',
          file_count: 1,
          total_size_bytes: blob.length,
          file_types: { fileType },
          processing_time_ms: elapsed,
          encryption_method: 'AES-256-GCM',
          success: blob ? true : false,
          operation_timestamp: new Date().toISOString()
        };
        if (blob) {
          const result = await req.payload.create({
            collection: 'encryption_operations',
            data: encrypt_result
          });
          if (result) return fileResponse(blob, fileName);
        }
        console.log('Fallo la creación de registro de operación de cifrado, revisar conexión a DB y parámetros de la consulta');
      }
    }
    return response(400, { error: `'Error en la petición` }, 'Error de usuario');
  } catch (error: any) {
    console.error(error);
    return response(500, { error: `'Error interno del servidor: ${error.message}` }, 'Error interno');
  }
};
