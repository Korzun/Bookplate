// Spike: does @pothos/plugin-prisma's prismaNode support Book's composite
// @@id([userId, id]) under Prisma 7?
// VERDICT: PASS — @pothos/plugin-prisma@4.15.0, @pothos/core@4.13.1, prisma@7.9.0.
// Both the "prisma-pothos-types" generator and prismaNode's compound-key
// encode/decode work under Prisma 7.
// Kept as a regression test: if a Prisma or Pothos upgrade breaks compound-key
// global IDs, this fails before the whole schema does.
//
// Two things beyond the brief's literal test code were needed to get here,
// neither related to compound keys:
//   1. builder's `prisma.client` is a context-function (per Pothos's own
//      recommendation, to keep the Prisma client out of the builder's
//      generic Context type) — that means the plugin can't introspect a live
//      client for its DMMF at schema-build time, so the generated
//      getDatamodel() must be passed as `prisma.dmmf` explicitly. This is
//      documented in @pothos/plugin-prisma's own README, not a bug.
//   2. `graphql` ships CJS ("main") and ESM ("module") builds with no
//      "exports" field. Vitest externalizes node_modules deps by default, so
//      Pothos's internal `import from 'graphql'` and this file's own
//      `import from 'graphql'` resolved to two different builds, producing
//      two distinct GraphQLSchema classes that failed `instanceof` checks
//      against each other. Fixed via `ssr.noExternal` in vite.config.ts —
//      see the comment there.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { graphql } from 'graphql';

import { runMigrations } from '../db/migrate';
import { hashLoginPassword } from '../services/password';
import { createUser } from '../services/user';
import { getDatamodel } from './generated/pothos-types';
import type PrismaTypes from './generated/pothos-types';

vi.mock('../logger');

type SpikeContext = { prisma: PrismaClient };

let prisma: PrismaClient;
let booksDir: string;
let dbPath: string;
let aliceId: string;

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-spike-'));
  dbPath = path.join(
    os.tmpdir(),
    `spike-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);

  await createUser(prisma, 'alice', await hashLoginPassword('alicepass'));
  aliceId = (await prisma.user.findUnique({ where: { username: 'alice' } }))!.id;

  await prisma.book.create({
    data: {
      userId: aliceId,
      id: 'a'.repeat(32),
      title: 'Dune',
      size: 1234,
      mtime: Date.now(),
      addedAt: Date.now(),
    },
  });
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksDir, { recursive: true });
});

const buildSpikeSchema = () => {
  const builder = new SchemaBuilder<{
    Context: SpikeContext;
    PrismaTypes: PrismaTypes;
  }>({
    plugins: [PrismaPlugin, RelayPlugin],
    // The client is loaded dynamically from context (per Pothos convention, to
    // keep the Prisma client out of the builder's generic Context type), so the
    // plugin can't introspect a live client instance at schema-build time. The
    // generated getDatamodel() supplies the same DMMF explicitly, per
    // https://github.com/hayes/pothos/tree/main/packages/plugin-prisma#set-up-the-builder.
    prisma: { client: (context: SpikeContext) => context.prisma, dmmf: getDatamodel() },
    relay: {},
  });

  const Book = builder.prismaNode('Book', {
    id: { field: 'userId_id' },
    fields: (t) => ({
      title: t.exposeString('title'),
    }),
  });

  builder.queryType({
    fields: (t) => ({
      firstBook: t.prismaField({
        type: Book,
        nullable: true,
        resolve: (query, _parent, _args, context) => context.prisma.book.findFirst({ ...query }),
      }),
    }),
  });

  return builder.toSchema();
};

it('encodes a global ID for a model with a composite primary key', async () => {
  const result = await graphql({
    schema: buildSpikeSchema(),
    source: '{ firstBook { id title } }',
    contextValue: { prisma },
  });

  expect(result.errors).toBeUndefined();
  const firstBook = (result.data as { firstBook: { id: string; title: string } }).firstBook;
  expect(firstBook.title).toBe('Dune');
  expect(firstBook.id.length).toBeGreaterThan(0);
});

it('decodes that global ID back to the same row through Query.node', async () => {
  const schema = buildSpikeSchema();

  const first = await graphql({
    schema,
    source: '{ firstBook { id } }',
    contextValue: { prisma },
  });
  const globalId = (first.data as { firstBook: { id: string } }).firstBook.id;

  const result = await graphql({
    schema,
    source: 'query ($id: ID!) { node(id: $id) { ... on Book { title } } }',
    contextValue: { prisma },
    variableValues: { id: globalId },
  });

  expect(result.errors).toBeUndefined();
  expect(result.data).toEqual({ node: { title: 'Dune' } });
});
