export type Permission =
  | 'admin.access'
  | 'admin.tenants.read'
  | 'admin.tenants.write'
  | 'admin.billing.mutate'
  | 'admin.billing.read'
  | 'admin.jobs.read'
  | 'admin.monitoring.read'
  | 'admin.audit.read'
  | 'cabinet.access'
  | 'cabinet.jobs.read'
  | 'cabinet.jobs.submit'
  | 'cabinet.billing.read'
  | 'cabinet.keys.manage'
  | 'cabinet.webhooks.manage';

export type AuthMembership = {
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | string;
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
};

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  platformRole: 'SUPERADMIN' | 'SUPPORT' | null;
  isActive: boolean;
  memberships: AuthMembership[];
};

const PLATFORM_PERMS: Record<'SUPERADMIN' | 'SUPPORT', Permission[]> = {
  SUPERADMIN: [
    'admin.access',
    'admin.tenants.read',
    'admin.tenants.write',
    'admin.billing.mutate',
    'admin.billing.read',
    'admin.jobs.read',
    'admin.monitoring.read',
    'admin.audit.read',
  ],
  SUPPORT: [
    'admin.access',
    'admin.tenants.read',
    'admin.billing.read',
    'admin.jobs.read',
    'admin.monitoring.read',
    'admin.audit.read',
  ],
};

const MEMBER_PERMS: Record<'OWNER' | 'ADMIN' | 'MEMBER', Permission[]> = {
  OWNER: [
    'cabinet.access',
    'cabinet.jobs.read',
    'cabinet.jobs.submit',
    'cabinet.billing.read',
    'cabinet.keys.manage',
    'cabinet.webhooks.manage',
  ],
  ADMIN: [
    'cabinet.access',
    'cabinet.jobs.read',
    'cabinet.jobs.submit',
    'cabinet.billing.read',
    'cabinet.keys.manage',
    'cabinet.webhooks.manage',
  ],
  MEMBER: [
    'cabinet.access',
    'cabinet.jobs.read',
    'cabinet.jobs.submit',
    'cabinet.billing.read',
  ],
};

export function permissionsFor(user: AuthUser | null | undefined, tenantId?: string | null): Set<Permission> {
  const set = new Set<Permission>();
  if (!user) return set;
  if (user.platformRole) {
    for (const p of PLATFORM_PERMS[user.platformRole]) set.add(p);
  }
  const membership = tenantId
    ? user.memberships.find((m) => m.tenantId === tenantId)
    : user.memberships[0];
  if (membership && (membership.role === 'OWNER' || membership.role === 'ADMIN' || membership.role === 'MEMBER')) {
    for (const p of MEMBER_PERMS[membership.role]) set.add(p);
  }
  return set;
}

export function can(
  user: AuthUser | null | undefined,
  permission: Permission,
  tenantId?: string | null,
): boolean {
  return permissionsFor(user, tenantId).has(permission);
}
