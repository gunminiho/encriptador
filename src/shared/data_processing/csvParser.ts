import type { PasswordMap } from '@/custom-types';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { normalizeFileName } from '@/shared/data_processing/converter';

// Parse CSV (delimitador ';' o ','; salta encabezado)
export async function parsePasswordsCsv(buf: Buffer): Promise<PasswordMap> {
  const map: PasswordMap = new Map();
  if (!buf?.length) return map;
  const rl = createInterface({ input: Readable.from(buf.toString('utf8')) });
  let isHeader = true;
  for await (const line of rl) {
    const l = line.trim();
    if (!l) continue;
    if (isHeader) {
      isHeader = false; // asume primera línea como header
      continue;
    }
    const [nameRaw, pw] = l.split(/[;,]/).map((s) => (s ?? '').trim());
    if (!nameRaw) continue;
    map.set(normalizeFileName(nameRaw), pw ?? '');
  }
  return map;
}
