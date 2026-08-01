import { createHarness, type Harness } from './test-util';

vi.mock('../logger');

/**
 * Harness-level DB assertions for `createHarness()`'s own output — not any
 * particular GraphQL field. `db/migrate.test.ts` already exercises
 * `runMigrations` in isolation against hand-seeded legacy schemas; this
 * checks the real bootstrap path (`createHarness`, which every schema test
 * runs through) produces the same guarantees on a brand-new database.
 */
describe('createHarness', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  // Regression for the composite index `getBookLineage` needs: it queries
  // `book_id_history` with `WHERE user_id = ? AND current_id = ?`, but the
  // table's primary key is (user_id, old_id) — see
  // prisma/migrations/20260801000000_book_id_history_current_id_index's own
  // comment. That plain migration's `CREATE INDEX` only survives on a
  // database that never runs `data_v11_per_user_libraries` (db/migrate.ts),
  // because that data migration rebuilds `book_id_history` from scratch
  // (DROP + recreate under a composite primary key), dropping the index
  // along with the pre-rebuild table. `data_v11_per_user_libraries` recreates
  // it immediately after the rebuild for exactly that reason — this asserts
  // the recreate actually happened on a fresh harness DB, not just that the
  // migration ran without error.
  it('has book_id_history_user_id_current_id_idx after migrations run', async () => {
    const indexes = await harness.prisma.$queryRaw<Array<{ name: string }>>`
      PRAGMA index_list(book_id_history)
    `;
    expect(indexes.map((i) => i.name)).toContain('book_id_history_user_id_current_id_idx');
  });
});
