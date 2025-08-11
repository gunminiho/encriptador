import type { PayloadFileRequest } from '@/custom-types';

export const csvParser = (csvFile: PayloadFileRequest): Map<string, string> | undefined => {
  const csvText = Buffer.from(csvFile?.data).toString('utf-8');
  const pwMap = new Map<string, string>();
  for (const line of csvText.split(/\r?\n/).filter((l) => l.trim())) {
    const [file_name, pwd] = line.split(/\s*[;,]\s*/).map((s) => s.trim());
    if (file_name && pwd) pwMap.set(file_name, pwd);
  }
  return csvText ? pwMap : undefined;
};
