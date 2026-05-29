import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export function createPrismaClient(url: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}
