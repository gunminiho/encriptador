import { FileEntryStream } from '@/custom-types';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function cleanupTemporaryFiles(fileList: FileEntryStream[]): Promise<void> {
  const cleanupPromises = fileList
    .filter((file) => file.tmpPath)
    .map(async (file) => {
      try {
        await fs.promises.unlink(file.tmpPath!);
      } catch (error) {
        console.warn(`No se pudo limpiar archivo temporal ${file.tmpPath}:`, error);
      }
    });

  await Promise.allSettled(cleanupPromises);
}

/**
 * Limpia toda la carpeta temporal de un request específico
 */
export async function cleanupRequestDirectory(tempDir: string): Promise<void> {
  try {
    console.log(`🧹 Limpiando directorio temporal: ${tempDir}`);

    // Verificar que existe
    const stats = await fs.promises.stat(tempDir).catch(() => null);
    if (!stats?.isDirectory()) {
      console.log(`📁 Directorio ${tempDir} no existe o no es directorio`);
      return;
    }

    // Leer contenido y eliminar recursivamente
    const files = await fs.promises.readdir(tempDir);
    console.log(`🗂️  Eliminando ${files.length} archivos de ${tempDir}`);

    // Eliminar todos los archivos
    const deletePromises = files.map(async (file) => {
      const filePath = path.join(tempDir, file);
      try {
        const fileStats = await fs.promises.stat(filePath);
        if (fileStats.isDirectory()) {
          await fs.promises.rmdir(filePath, { recursive: true });
        } else {
          await fs.promises.unlink(filePath);
        }
      } catch (error) {
        console.warn(`⚠️  No se pudo eliminar ${filePath}:`, error);
      }
    });

    await Promise.allSettled(deletePromises);

    // Eliminar la carpeta principal
    await fs.promises.rmdir(tempDir);
    console.log(`✅ Directorio temporal eliminado: ${tempDir}`);
  } catch (error) {
    console.error(`❌ Error limpiando directorio temporal ${tempDir}:`, error);
    // No lanzar error aquí para no afectar el flujo principal
  }
}

/**
 * Limpia múltiples directorios temporales (para cleanup general)
 */
export async function cleanupOldRequestDirectories(maxAgeHours: number = 24): Promise<void> {
  const payloadTempDir = path.join(os.tmpdir(), 'payload-encrypt');

  try {
    const entries = await fs.promises.readdir(payloadTempDir, { withFileTypes: true });
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000; // horas a milisegundos

    const cleanupPromises = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('req_'))
      .map(async (entry) => {
        const dirPath = path.join(payloadTempDir, entry.name);

        try {
          const stats = await fs.promises.stat(dirPath);
          const age = now - stats.mtime.getTime();

          if (age > maxAge) {
            console.log(`🧹 Limpiando directorio antiguo: ${entry.name} (${(age / 1000 / 60 / 60).toFixed(1)}h)`);
            await cleanupRequestDirectory(dirPath);
          }
        } catch (error) {
          console.warn(`⚠️  Error verificando directorio ${entry.name}:`, error);
        }
      });

    await Promise.allSettled(cleanupPromises);
  } catch (error) {
    console.warn('⚠️  Error limpiando directorios antiguos:', error);
  }
}
