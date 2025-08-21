import fs from 'fs';
import path from 'path';

const deletedPaths = new Set<string>();

export async function cleanupRequestDirectory(tempDir: string): Promise<void> {
  const dir = path.normalize(tempDir);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (e: any) {
    if (e?.code !== 'ENOENT') console.error(`❌ Error limpiando ${dir}:`, e);
  }
}

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
