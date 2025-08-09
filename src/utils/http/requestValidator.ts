import { response, handleError } from '@/utils/http/response';
import { MassiveEncryptionRequest } from '../http/requestProcesses';
import { isAllowedFile } from '../data_processing/fileChecker';

export const validateMassiveRequest = async (massiveData: MassiveEncryptionRequest, pwMap: Map<string, string> | string, errors: Array<string>): Promise<Response | void> => {
  // 4️⃣ Validaciones: que cada archivo tenga password, etc
  try {
    const { dataFiles } = massiveData;
    const missing = pwMap instanceof Map ? dataFiles.filter((f) => !pwMap.has(f.name)) : [];
    for (const file of dataFiles) {
      const { allowed, extension, mimeType } = await isAllowedFile(file?.data, file?.name);
      if (!allowed) errors.push(`el tipo de archivo .${extension} o mime-type ${mimeType} no esta permitido.`);
    }
    if (dataFiles.length < 2) errors.push('Se necesitan ≥2 archivos para encriptación masiva');
    if (dataFiles.length > 1000) errors.push('Solo se pueden enviar 1000 archivos por petición para encriptar');
    if (missing.length > 0) errors.push(`Faltan passwords para: ${missing.map((f) => f.name).join(',')}`);
    if (errors.length > 0) return response(400, { error: errors }, 'Bad Request');
  } catch (error: unknown) {
    return handleError(error, 'Error en la validación de info de encriptación masiva', 'massive-encryption', 500);
  }
};

export const validateSingleRequest = async () => {
  try {
    
  } catch (error: unknown) {
    return handleError(error, 'Error en la validación de info de encriptación', 'encryption', 500);
  }
};
