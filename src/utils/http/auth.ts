import type { PayloadRequest } from 'payload';
import { response } from '@/utils/http/response';

export const isValidUser = async (req: PayloadRequest): Promise<Response | boolean> => {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.includes('API-Key') || !req.user) {
    return response(401, { error: 'No autorizado' }, 'Api Key inválida');
  }
  return true;
};
