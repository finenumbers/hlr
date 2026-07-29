export { PrismaClient, Prisma } from '@prisma/client';
export type * from '@prisma/client';

import { PrismaClient } from '@prisma/client';

/** Shared factory for api/worker — callers own lifecycle ($connect / $disconnect). */
export function createPrismaClient(options?: ConstructorParameters<typeof PrismaClient>[0]): PrismaClient {
  return new PrismaClient(options);
}
