import { FileEntryStream } from '@/custom-types';
import fs from 'fs';
import path from 'path';
import os from 'os';

// export async function cleanupTemporaryFiles(fileList: FileEntryStream[]): Promise<void> {
//   const cleanupPromises = fileList
//     .filter((file) => file.tmpPath)
//     .map(async (file) => {
//       try {
//         await fs.promises.unlink(file.tmpPath!);
//       } catch (error) {
//         console.warn(`No se pudo limpiar archivo temporal ${file.tmpPath}:`, error);
//       }
//     });

//   await Promise.allSettled(cleanupPromises);
// }

// /**
//  * Limpia toda la carpeta temporal de un request específico
//  */
// export async function cleanupRequestDirectory(tempDir: string): Promise<void> {
//   try {
//     //console.log(`🧹 Limpiando directorio temporal: ${tempDir}`);

//     // Verificar que existe
//     const stats = await fs.promises.stat(tempDir).catch(() => null);
//     if (!stats?.isDirectory()) {
//       console.log(`📁 Directorio ${tempDir} no existe o no es directorio`);
//       return;
//     }

//     // Leer contenido y eliminar recursivamente
//     const files = await fs.promises.readdir(tempDir);
//     //console.log(`🗂️  Eliminando ${files.length} archivos de ${tempDir}`);

//     // Eliminar todos los archivos
//     const deletePromises = files.map(async (file) => {
//       const filePath = path.join(tempDir, file);
//       try {
//         const fileStats = await fs.promises.stat(filePath);
//         if (fileStats.isDirectory()) {
//           await fs.promises.rmdir(filePath, { recursive: true });
//         } else {
//           await fs.promises.unlink(filePath);
//         }
//       } catch (error) {
//         console.warn(`⚠️  No se pudo eliminar ${filePath}:`, error);
//       }
//     });

//     await Promise.allSettled(deletePromises);

//     // Eliminar la carpeta principal
//     await fs.promises.rmdir(tempDir);
//     //console.log(`✅ Directorio temporal eliminado: ${tempDir}`);
//   } catch (error) {
//     console.error(`❌ Error limpiando directorio temporal ${tempDir}:`, error);
//     // No lanzar error aquí para no afectar el flujo principal
//   }
// }

// /**
//  * Limpia múltiples directorios temporales (para cleanup general)
//  */
// export async function cleanupOldRequestDirectories(maxAgeHours: number = 24): Promise<void> {
//   const payloadTempDir = path.join(os.tmpdir(), 'payload-encrypt');

//   try {
//     const entries = await fs.promises.readdir(payloadTempDir, { withFileTypes: true });
//     const now = Date.now();
//     const maxAge = maxAgeHours * 60 * 60 * 1000; // horas a milisegundos

//     const cleanupPromises = entries
//       .filter((entry) => entry.isDirectory() && entry.name.startsWith('req_'))
//       .map(async (entry) => {
//         const dirPath = path.join(payloadTempDir, entry.name);

//         try {
//           const stats = await fs.promises.stat(dirPath);
//           const age = now - stats.mtime.getTime();

//           if (age > maxAge) {
//             //console.log(`🧹 Limpiando directorio antiguo: ${entry.name} (${(age / 1000 / 60 / 60).toFixed(1)}h)`);
//             await cleanupRequestDirectory(dirPath);
//           }
//         } catch (error) {
//           console.warn(`⚠️  Error verificando directorio ${entry.name}:`, error);
//         }
//       });

//     await Promise.allSettled(cleanupPromises);
//   } catch (error) {
//     console.warn('⚠️  Error limpiando directorios antiguos:', error);
//   }
// }

function normalize(p: string) {
  return path.normalize(p);
}

export async function cleanupTemporaryFiles(fileList: ReadonlyArray<FileEntryStream>): Promise<void> {
  const jobs = fileList
    .filter((f) => !!f.tmpPath)
    .map(async (f) => {
      const p = normalize(f.tmpPath!);
      try {
        // rm es idempotente con force:true; evita ENOENT en Linux/Windows
        await fs.promises.rm(p, { force: true, recursive: false, maxRetries: 3, retryDelay: 50 });
      } catch (e) {
        // EPERM/EBUSY: espera breve y reintenta una vez
        if ((e as any)?.code === 'EPERM' || (e as any)?.code === 'EBUSY') {
          await new Promise((r) => setTimeout(r, 80));
          await fs.promises.rm(p, { force: true, recursive: false });
        } else {
          console.warn(`⚠️  No se pudo limpiar archivo temporal ${p}:`, e);
        }
      }
    });

  await Promise.allSettled(jobs);
}

export async function cleanupRequestDirectory(tempDir: string): Promise<void> {
  const dir = path.normalize(tempDir);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (e: any) {
    if (e?.code !== 'ENOENT') console.error(`❌ Error limpiando ${dir}:`, e);
  }
}

export async function cleanupOldRequestDirectories(maxAgeHours: number = 24): Promise<void> {
  const payloadTempDir = path.join(os.tmpdir(), 'payload-encrypt');

  try {
    const entries = await fs.promises.readdir(payloadTempDir, { withFileTypes: true });
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    const jobs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith('req_'))
      .map(async (e) => {
        const dirPath = path.join(payloadTempDir, e.name);
        try {
          const st = await fs.promises.stat(dirPath).catch(() => null);
          if (!st?.isDirectory()) return;
          const age = now - st.mtime.getTime();
          if (age > maxAgeMs) {
            await cleanupRequestDirectory(dirPath);
          }
        } catch (err) {
          console.warn(`⚠️  Error verificando ${e.name}:`, err);
        }
      });

    await Promise.allSettled(jobs);
  } catch (error) {
    // Si no existe la carpeta base, no es error en producción
    if ((error as any)?.code !== 'ENOENT') {
      console.warn('⚠️  Error listando payload-encrypt:', error);
    }
  }
}

const deletedPaths = new Set<string>();

export async function unlinkQuiet(p?: string): Promise<void> {
  if (!p) return;
  const np = path.normalize(p);
  if (deletedPaths.has(np)) return; // idempotente

  try {
    await fs.promises.rm(np, { force: true, recursive: false, maxRetries: 3, retryDelay: 50 });
    deletedPaths.add(np);
  } catch (e: any) {
    // Ignora ENOENT; registra solo si es algo distinto
    if (e?.code !== 'ENOENT') {
      console.warn(`⚠️  No se pudo eliminar ${np}:`, e);
    }
  }
}
