import { PayloadRequest } from 'payload';
import { AdminUser, RegularUser, TenantAuth } from '@/custom-types';

export const USERS_SLUG = 'users' as const;
export const TENANTS_SLUG = 'tenants' as const;
// Header case-sensitive según la doc: "tenants API-Key <token>"
export const AUTH_RE = new RegExp(`^${TENANTS_SLUG}\\s+API-Key\\s+(.+)$`);

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
