import { response } from '@/utils/http/response';
import { MassiveEncryptionRequest } from '../http/requestProcesses';

export const validateRequest = (massiveData: MassiveEncryptionRequest, pwMap: Map<string, string> | string): Response | boolean => {
  // 4️⃣ Validaciones: que cada archivo tenga password, etc
  const errors: Array<string> = [];
  const { csvFile, dataFiles } = massiveData;
  const missing = pwMap instanceof Map ? dataFiles.filter((f) => !pwMap.has(f.name)) : [];
  if (!csvFile || pwMap instanceof String) errors.push(pwMap as string);
  if (dataFiles.length < 2) errors.push('Se necesitan ≥2 archivos para encriptación masiva');
  if (missing.length) errors.push(`Faltan passwords para: ${missing.map((f) => f.name).join(', ')}`);
  if (errors.length > 0) return response(400, { error: errors.join(', ') }, 'Bad Request');
  //return response(400, { error: errors.join(', ') }, 'Bad Request');
  return true;
};
