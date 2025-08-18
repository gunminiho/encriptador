import { response, handleError } from '@/utils/http/response';
import type { MassiveEncryptionRequest, SingleEncryptionRequest, ParsedMassiveRequest, ValidationResult } from '@/custom-types';
import { normalizeFileName } from '../data_processing/converter';
import fs from 'fs';
import { isAllowedFile } from '../data_processing/fileChecker';

export const validateMassiveRequest = async (massiveData: MassiveEncryptionRequest, pwMap: Map<string, string>, errors: Array<string>): Promise<Response | void> => {
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

export const validateSingleRequest = async (requestData: SingleEncryptionRequest, errors: Array<string>) => {
  try {
    const { file, password } = requestData;
    if (typeof file === 'undefined') errors.push('No se detecto archivo para encriptar');
    if (typeof password === 'undefined') errors.push('No se detecto password para encriptar');
    if (typeof file === 'object' && file !== null && !Buffer.isBuffer(file.data)) errors.push('El archivo no es válido');
    if (password && typeof password !== 'string') errors.push('La contraseña debe ser un string');
    if (file && file.size > Number(process.env.FILE_SIZE_LIMIT) * 1024 * 1024) errors.push(`El archivo excede el tamaño máximo permitido de ${process.env.FILE_SIZE_LIMIT}MB`);
    const { allowed, extension, mimeType } = await isAllowedFile(file?.data, file?.name);
    if (!allowed && extension !== 'unknown') errors.push(`el tipo de archivo .${extension} o mime-type ${mimeType} no esta permitido`);
    if (errors.length > 0) return response(400, { error: errors }, 'Bad Request');
  } catch (error: unknown) {
    return handleError(error, 'Error en la validación de archivos de encriptación', 'encryption', 500);
  }
};

export async function validateMassiveEncryptionRequest(parsedData: ParsedMassiveRequest, errors: string[]): Promise<ValidationResult> {
  const { fileList, passwords, totalFiles } = parsedData;

  // Validación básica de cantidad
  if (totalFiles < 2) {
    errors.push('Se necesitan ≥2 archivos para encriptación masiva');
  }

  // // Validación de límite de archivos, no cuenta el .csv para passwords
  // if (totalFiles > 1001) {
  //   errors.push('Solo se pueden enviar 1000 archivos por petición para encriptar');
  // }

  // Validar passwords faltantes
  const missingPasswords: string[] = [];
  for (const file of fileList) {
    const normalizedName = normalizeFileName(file.filename);
    if (!passwords.has(normalizedName)) {
      missingPasswords.push(file.filename);
    }
  }

  if (missingPasswords.length > 0) {
    errors.push(`Faltan passwords para: ${missingPasswords.join(', ')}`);
  }

  // Validar tipos de archivo
  for (const file of fileList) {
    try {
      // Leer una muestra del archivo para validar tipo
      const sampleSize = Math.min(1024 * 1024, 1024); // 1KB muestra
      const buffer = Buffer.alloc(sampleSize);

      const fileHandle = await fs.promises.open(file.tmpPath!, 'r');
      const { bytesRead } = await fileHandle.read(buffer, 0, sampleSize, 0);
      await fileHandle.close();

      const sampleBuffer = buffer.subarray(0, bytesRead);
      const { allowed, extension, mimeType } = await isAllowedFile(sampleBuffer, file.filename);
      if (!allowed || extension === 'unknown') errors.push(`El tipo de archivo .${extension} o mime-type ${mimeType} no está permitido para ${file.filename}`);
    } catch (validationError) {
      //console.warn(`Error validando tipo de archivo ${file.filename}:`, validationError);
      errors.push(`No se pudo validar el tipo de archivo ${file.filename}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors: [...errors] // Copia del array
  };
}
