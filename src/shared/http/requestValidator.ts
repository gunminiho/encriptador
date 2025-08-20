import type { ParsedMassiveRequest, ValidationResult } from '@/custom-types';
import { normalizeFileName } from '../data_processing/converter';
import fs from 'fs';
import { isAllowedFile } from '../data_processing/fileChecker';

const maxFiles = process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : 1000;

export async function validateMassiveEncryptionRequest(parsedData: ParsedMassiveRequest, errors: string[]): Promise<ValidationResult> {
  const { fileList, passwords, totalFiles } = parsedData;

  // Validación básica de cantidad
  if (totalFiles < 2) {
    errors.push('Se necesitan ≥2 archivos para encriptación masiva');
  }

  // // Validación de límite de archivos, no cuenta el .csv para passwords
  if (totalFiles > maxFiles) {
    errors.push(`Solo se pueden enviar ${maxFiles} archivos por petición para encriptar`);
  }

  // Validar passwords faltantes
  const missingPasswords: string[] = [];
  for (const file of fileList) {
    const normalizedName = normalizeFileName(file.filename);
    if (!passwords.has(normalizedName)) {
      missingPasswords.push(file.filename);
    }
  }

  if (missingPasswords.length > 0 && parsedData.passwordFile) {
    errors.push(`Faltan passwords para: ${missingPasswords.join(', ')}`);
  }

  if (!parsedData.passwordFile) {
    // Validar que el archivo CSV de contraseñas tenga el formato correcto
    errors.push('El archivo CSV de contraseñas no es válido');
  }

  // Validar tipos de archivo
  for (const file of fileList) {
    try {
      // Leer una muestra del archivo para validar tipo
      const sampleSize = 1 * 1024; //Math.min(1 * 1024, 1024); // 1KB muestra
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
