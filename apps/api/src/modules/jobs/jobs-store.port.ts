import type { JobsStore } from '@finenumbers/jobs';

/** Nest DI token for JobsStore (Prisma in prod, InMemory in e2e). */
export const JOBS_STORE = Symbol('JOBS_STORE');

export type { JobsStore };
