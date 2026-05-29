// prisma.config.ts — used by the Prisma CLI (generate, studio, etc.)
// At runtime the connection URL is supplied via PrismaBetterSqlite3 adapter.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
  },
});
