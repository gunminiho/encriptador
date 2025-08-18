import { cleanupOldRequestDirectories } from "../data_processing/cleaningTempFiles";
import path from 'path';
import fs from 'fs';
import os from 'os';
// ============================================================================
// CRON JOB PARA LIMPIEZA AUTOMÁTICA (OPCIONAL)
// ============================================================================

/**
 * Función que se puede llamar periódicamente para limpiar directorios antiguos
 * Útil para un cron job o tarea programada
 */
export async function scheduleCleanup(): Promise<void> {
  console.log('🧹 Ejecutando limpieza programada de directorios temporales...');
  
  try {
    await cleanupOldRequestDirectories(2); // Limpiar directorios > 2 horas
    console.log('✅ Limpieza programada completada');
  } catch (error) {
    console.error('❌ Error en limpieza programada:', error);
  }
}

// ============================================================================
// UTILIDADES DE MONITOREO
// ============================================================================

/**
 * Obtiene estadísticas del directorio temporal
 */
export async function getTempDirectoryStats(): Promise<{
  totalDirectories: number;
  totalSizeMB: number;
  oldestDirectory: string | null;
  newestDirectory: string | null;
}> {
  const payloadTempDir = path.join(os.tmpdir(), 'payload-encrypt');
  
  try {
    const entries = await fs.promises.readdir(payloadTempDir, { withFileTypes: true });
    const directories = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('req_'));
    
    let totalSize = 0;
    let oldestTime = Date.now();
    let newestTime = 0;
    let oldestDir = null;
    let newestDir = null;

    for (const dir of directories) {
      const dirPath = path.join(payloadTempDir, dir.name);
      try {
        const stats = await fs.promises.stat(dirPath);
        const dirSize = await getDirSize(dirPath);
        
        totalSize += dirSize;
        
        if (stats.mtime.getTime() < oldestTime) {
          oldestTime = stats.mtime.getTime();
          oldestDir = dir.name;
        }
        
        if (stats.mtime.getTime() > newestTime) {
          newestTime = stats.mtime.getTime();
          newestDir = dir.name;
        }
      } catch {}
    }

    return {
      totalDirectories: directories.length,
      totalSizeMB: totalSize / (1024 * 1024),
      oldestDirectory: oldestDir,
      newestDirectory: newestDir
    };
  } catch {
    return {
      totalDirectories: 0,
      totalSizeMB: 0,
      oldestDirectory: null,
      newestDirectory: null
    };
  }
}

async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const files = await fs.promises.readdir(dirPath);
    for (const file of files) {
      const stats = await fs.promises.stat(path.join(dirPath, file));
      size += stats.size;
    }
  } catch {}
  return size;
}