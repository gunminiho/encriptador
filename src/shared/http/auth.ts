import type { PayloadRequest } from 'payload';
import { response } from '@/shared/http/response';
import type { Access } from 'payload';
import { isAdminReq, isUsersReq, isTenantReq, AUTH_RE, TENANTS_SLUG } from './authHelper';

export const onlyAdmins: Access = ({ req }) => isAdminReq(req);
export const onlyUsersAuth: Access = ({ req }) => isUsersReq(req);
export const allowTenantsOnly: Access = ({ req }) => isTenantReq(req);
export const denyTenants: Access = ({ req }) => !isTenantReq(req);

export const isValidUser = async (req: PayloadRequest): Promise<Response | boolean> => {
  // ✅ Headers de Request
  const auth = (req.headers.get('Authorization') || '').trim();
  const u = req.user as any;
  const match = AUTH_RE.exec(auth);

  if (!match) return response(401, { error: 'No autorizado' }, 'Authorization debe ser: "tenants API-Key <token>"');
  if (!u || u.collection !== TENANTS_SLUG) return response(403, { error: 'Forbidden', user: req.user }, 'La API Key no pertenece a la colección tenants');
  if (u.state === false) return response(403, { error: 'Forbidden' }, 'Tenant deshabilitado');

  return true;
};
