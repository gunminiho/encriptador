import type { PayloadRequest } from 'payload';
import { response } from '@/shared/http/response';
import type { Access } from 'payload';
import type { AdminUser, RegularUser, TenantAuth } from '@/custom-types';

const USERS_SLUG = 'users' as const;
const TENANTS_SLUG = 'tenants' as const;
// Header case-sensitive según la doc: "tenants API-Key <token>"
const AUTH_RE = new RegExp(`^${TENANTS_SLUG}\\s+API-Key\\s+(.+)$`);

// ---------- Type guards (req.user) ----------
export function isAdminReq(req: PayloadRequest): req is PayloadRequest & { user: AdminUser } {
  const u = req.user as any;
  return !!u && u.collection === USERS_SLUG && u.role === 'admin';
}
export function isUsersReq(req: PayloadRequest): req is PayloadRequest & { user: AdminUser | RegularUser } {
  const u = req.user as any;
  return !!u && u.collection === USERS_SLUG;
}
export function isTenantReq(req: PayloadRequest): req is PayloadRequest & { user: TenantAuth } {
  const u = req.user as any;
  return !!u && u.collection === TENANTS_SLUG;
}

// ---------- Access helpers para collections ----------
export const onlyAdmins: Access = ({ req }) => isAdminReq(req);
export const onlyUsersAuth: Access = ({ req }) => isUsersReq(req);
export const allowTenantsOnly: Access = ({ req }) => isTenantReq(req);
export const denyTenants: Access = ({ req }) => !isTenantReq(req);

/** Exige usuario admin autenticado (colección users, role=admin). */
export function requireAdmin(req: PayloadRequest, res: any): req is PayloadRequest & { user: AdminUser } {
  if (!isAdminReq(req)) {
    res?.status?.(403)?.json?.({ error: 'Forbidden', reason: 'Solo administradores' });
    return false;
  }
  return true;
}

export const isValidUser = async (req: PayloadRequest): Promise<Response | boolean> => {
  // ✅ Estilo Next/Fetch
  const auth = (req.headers.get('Authorization') || '').trim();

  // 1) Validar el formato exacto del header (case-sensitive)
  const match = AUTH_RE.exec(auth);
  if (!match) {
    return response(401, { error: 'No autorizado' }, 'Authorization debe ser: "tenants API-Key <token>"');
  }

  const u = req.user as any;
  if (!u || u.collection !== TENANTS_SLUG) {
    return response(403, { error: 'Forbidden', user: req.user }, 'La API Key no pertenece a la colección tenants');
  }

  if (u.state === false) {
    return response(403, { error: 'Forbidden' }, 'Tenant deshabilitado');
  }

  return true;
};
