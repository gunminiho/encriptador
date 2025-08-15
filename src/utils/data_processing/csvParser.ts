import type { PayloadFileRequest, PasswordMap } from '@/custom-types';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { normalizeFileName } from '@/utils/data_processing/converter';

export const csvParser = (csvFile: PayloadFileRequest): Map<string, string> | undefined => {
  const csvText = Buffer.from(csvFile?.data).toString('utf-8');
  const pwMap = new Map<string, string>();
  for (const line of csvText.split(/\r?\n/).filter((l) => l.trim())) {
    const [file_name, pwd] = line.split(/\s*[;,]\s*/).map((s) => s.trim());
    if (file_name && pwd) pwMap.set(file_name, pwd);
  }
  return csvText ? pwMap : undefined;
};

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
