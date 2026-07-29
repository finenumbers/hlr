import type { MembershipRole, PlatformRole } from '@finenumbers/db';

/**
 * Request-scoped principal attached after authentication (session/JWT/API key).
 * Populated by AuthGuard once real auth lands (E04/E05).
 */
export type AuthenticatedUser = {
  userId: string;
  email: string;
  platformRole: PlatformRole | null;
  /** Active tenant for this request (cabinet / API key scope). */
  tenantId: string | null;
  /** Membership role within `tenantId`, if any. */
  membershipRole: MembershipRole | null;
};

export type AppRole = PlatformRole | MembershipRole;
