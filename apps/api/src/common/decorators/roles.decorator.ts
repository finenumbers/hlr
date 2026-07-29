import { SetMetadata } from '@nestjs/common';

import type { AppRole } from '../types/authenticated-user';

export const ROLES_KEY = 'roles';

/** Requires the authenticated principal to hold at least one of the listed roles. */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
