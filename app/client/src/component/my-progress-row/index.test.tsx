import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  ProgressDeleteMutation,
  ProgressDeleteMutationVariables,
  ProgressRowFragmentFragment,
} from '~/gql/graphql';
import { ProgressDeleteDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { MyProgressRow, ProgressRowFragment } from './index';

// `LinkProgressModal`'s own internals (Task 6, GraphQL-backed) have their own
// dedicated test file (`control/link-progress-modal/index.test.tsx`) —
// stubbed here so these tests exercise only the OPENER this row owns (the
// `Button` + `showLinkModal` state + the `libraryId`/`progressId` props it
// passes) without also satisfying the modal's own data requirements.
//
// Deliberately NOT `importOriginal()` (an earlier version of this mock did)
// — see `component/user-progress-row/index.test.tsx`'s identical mock for
// the full trace: `~/control`'s barrel re-exports `SetProgressModal`, which
// reaches `~/provider/library-target` (a KEPT provider, out of scope to
// restructure), which reaches `component/user-row` -> `user-row-content` ->
// `user-progress-row` -> back to THIS module, a genuine circular import
// into `~/control` that leaves this row's own `~/control` import bound to
// the REAL `LinkProgressModal` instead of the stub. `Button`/`ConfirmModal`
// are pulled from their own leaf subpaths instead, which do not re-enter
// the cycle.
vi.mock('~/control', async () => {
  const { Button } = await import('~/control/button');
  const { ConfirmModal } = await import('~/control/confirm-modal');
  return {
    Button,
    ConfirmModal,
    LinkProgressModal: ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div>link-progress-modal</div> : null,
  };
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

/**
 * A typed `ProgressRowFragmentFragment` VARIABLE, never an inline object
 * literal at the call site — assigning a variable (vs. a fresh literal) is
 * what avoids TypeScript's excess-property check against `MyProgressRow`'s
 * `progress` prop, whose declared type is the MASKED `FragmentType<typeof
 * ProgressRowFragment>`. Mirrors `use-progress-mutations.test.tsx`'s
 * `progressRow` helper. `makeFragmentData` (below, at each call site) is
 * the sanctioned cast from this concrete shape to the masked one — plain
 * assignment fails: `FragmentType<...>`'s only member is an OPTIONAL
 * `$fragmentRefs` key, and TypeScript's "weak type" detection (TS2559)
 * rejects a value carrying the (also optional, but DIFFERENT) `$fragmentName`
 * marker `ProgressRowFragmentFragment` carries instead.
 */
const progressRow = (
  overrides: Partial<{
    id: string;
    document: string;
    percentage: number;
    currentChapter: number | null;
    device: string;
    timestamp: string;
    book: ProgressRowFragmentFragment['book'];
  }> = {}
): ProgressRowFragmentFragment => ({
  __typename: 'Progress',
  id: overrides.id ?? 'progress-1',
  document: overrides.document ?? 'doc-hash-1',
  percentage: overrides.percentage ?? 0.5,
  currentChapter: overrides.currentChapter ?? 1,
  device: overrides.device ?? 'Kindle',
  timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
  book:
    overrides.book !== undefined
      ? overrides.book
      : {
          __typename: 'Book',
          id: 'book-1',
          title: 'Dune',
          author: 'Frank Herbert',
          hasCover: false,
          thumbnailUrl: '',
        },
});

/**
 * Writes the row into a REAL, normalized `InMemoryCache` (via
 * `writeFragment`, mirroring `control/link-progress-modal/index.test.tsx`'s
 * own `seedOrphanProgress`) so `Progress:<id>` genuinely exists as an
 * entity before a delete test runs — otherwise `cache.evict` (inside
 * `useDeleteProgress`) would be evicting nothing, and a test asserting the
 * entity is GONE afterward would pass vacuously whether or not the
 * eviction code ran at all.
 *
 * Deliberately NOT `client.writeQuery(MyProgressListDocument, ...)` (an
 * earlier version of this helper did): importing that document from
 * `component/my-progress-content` here would pull `~/control` into this
 * test file's graph a SECOND way (that component imports `Button`), which
 * — combined with this file's own `vi.mock('~/control', importOriginal)`
 * below — resolves `control/upload-replace-modal`'s REAL `~/component`
 * barrel import, which re-exports `MyProgressRow` itself and re-enters this
 * module before its own `~/control` import has been mock-substituted,
 * silently binding it to the REAL `LinkProgressModal` (seen-to-fail: this
 * regression broke "opens the link modal when Link is clicked" below,
 * which started rendering the real modal's "Link Progress" dialog instead
 * of the `link-progress-modal` stub). `writeFragment` needs only
 * `ProgressRowFragment`, already imported from `./index` below — no new
 * cross-import, no cycle.
 */
const seedProgressEntity = (client: ApolloClient, row: ProgressRowFragmentFragment) =>
  client.cache.writeFragment({
    id: client.cache.identify({ __typename: 'Progress', id: row.id }),
    fragment: ProgressRowFragment,
    data: row,
  });

const deleteSuccessMock = (
  progressId: string
): MockedResponse<ProgressDeleteMutation, ProgressDeleteMutationVariables> => ({
  request: { query: ProgressDeleteDocument, variables: { id: progressId } },
  result: {
    data: {
      __typename: 'Mutation',
      progressDelete: {
        __typename: 'ProgressDeletePayload',
        deletedId: progressId,
        library: { __typename: 'Library', id: 'lib-1' },
        user: { __typename: 'User', id: 'user-1', progressCount: 0 },
      },
    },
  },
});

const deleteErrorMock = (
  progressId: string
): MockedResponse<ProgressDeleteMutation, ProgressDeleteMutationVariables> => ({
  request: { query: ProgressDeleteDocument, variables: { id: progressId } },
  error: new Error('Network error'),
});

const clickConfirmClear = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /clear/i }));
  const clearButtons = screen.getAllByRole('button', { name: /^clear$/i });
  await user.click(clearButtons[clearButtons.length - 1]);
};

describe('MyProgressRow', () => {
  it('renders a Clear button when progress is loaded', () => {
    renderWithApollo(
      <MyProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        libraryId="lib-1"
      />
    );
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithApollo(
      <MyProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        libraryId="lib-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  // Fixture-gap requirement: the entity is seeded into a REAL InMemoryCache
  // via `seedProgressEntity`, and `useDeleteProgress` is the REAL hook from
  // `~/lib/use-progress-mutations` (not mocked) — so this proves the row
  // wires its unmasked `row.id` (the Relay GLOBAL id) into `deleteProgress`, and that
  // the resulting `progressDelete` mutation's `update` callback actually
  // evicts the entity from the cache. `MockLink` throws on an unmatched
  // operation, so a call carrying the wrong id (e.g. the raw `document`
  // instead of `id`) would fail to match `deleteSuccessMock` and surface as
  // an error here rather than pass silently.
  it('calls deleteProgress with the Progress global id and evicts it from the cache when confirmed', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1', document: 'doc-hash-1' });
    const { client } = renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />,
      { mocks: [deleteSuccessMock('progress-1')] }
    );
    seedProgressEntity(client, row);

    await clickConfirmClear(user);

    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(extracted['Progress:progress-1']).toBeUndefined();
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithApollo(
      <MyProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        libraryId="lib-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1' });
    const { client } = renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />,
      { mocks: [deleteSuccessMock('progress-1')] }
    );
    seedProgressEntity(client, row);

    await clickConfirmClear(user);

    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
  });

  it('shows an error toast when delete fails', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1' });
    const { client } = renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />,
      { mocks: [deleteErrorMock('progress-1')] }
    );
    seedProgressEntity(client, row);

    await clickConfirmClear(user);

    await waitFor(() => expect(screen.getByText('Failed to clear progress')).toBeInTheDocument());
    // A failed delete leaves the cache untouched — the fixture-gap this
    // suite closes is exactly a broken clear path being unobservable, so
    // this proves the entity SURVIVES a failure, not just that a toast fired.
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(extracted['Progress:progress-1']).toBeDefined();
  });

  // Inapplicable (was "prefers titleSort over title for a resolved book"):
  // `ProgressRowFragment` — colocated on THIS component (`./index.tsx`), not
  // on `graphql/progress.ts` as this note used to say; see that module's own
  // doc comment, which points here — selects
  // `book { id title author hasCover thumbnailUrl }`
  // — no `titleSort`. There is no sort-title field on this row's data to
  // prefer over `title` any more.
  it('renders the book title for a resolved book', () => {
    const row = progressRow({
      book: {
        __typename: 'Book',
        id: 'book-1',
        title: 'Dune',
        author: 'Frank Herbert',
        hasCover: false,
        thumbnailUrl: '',
      },
    });
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />
    );
    expect(screen.getByText('Dune')).toBeInTheDocument();
  });

  // Fix round 1: this row still renders "the raw document" for a null
  // `book` — that part of the original assertion stands — but it is NOT
  // "with no book link" any more. The Link BUTTON (the affordance that
  // OPENS `LinkProgressModal`) is restored below; only the modal's
  // internals stay deferred to a later task (design spec §6). See the
  // component's own doc comment for the corrected reasoning.
  it('renders a row whose book is null using the raw document', () => {
    const row = progressRow({ document: 'orphan-doc-hash', book: null });
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />
    );
    expect(screen.getByText('orphan-doc-hash')).toBeInTheDocument();
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
  });

  it('does not show a Link button for a resolved book', () => {
    renderWithApollo(
      <MyProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        libraryId="lib-1"
      />
    );
    expect(screen.queryByRole('button', { name: /^link$/i })).not.toBeInTheDocument();
  });

  // Restored (fix round 1): was judged inapplicable when the Link button
  // itself was mistakenly dropped. `isUnresolved` (`row.book === null`) is
  // the only gate on the button now — there is no per-row loading state to
  // additionally check (see the next test's doc comment).
  it('shows a Link button when the book is null', () => {
    const row = progressRow({ book: null });
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />
    );
    expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument();
  });

  // Inapplicable (was "does not show a Link button while the book is
  // loading"): fetch-free rows have no per-row loading state at all —
  // `book` arrives already resolved (or genuinely `null`) as part of the
  // parent connection page (`component/my-progress-content`'s
  // `MyProgressListDocument`; the deleted `use-my-progress-list.ts` until
  // Task 4), so there is no
  // intermediate "still resolving" state for the button to be gated against.

  // Restored (fix round 1): was judged inapplicable alongside the button
  // itself. `LinkProgressModal` is stubbed above (this task does not touch
  // its internals — still REST-backed); `username` must be defined for the
  // modal to mount (`showLinkModal && username !== undefined`, mirroring
  // the pre-migration row), hence the explicit `user` override here.
  it('opens the link modal when Link is clicked', async () => {
    const row = progressRow({ book: null });
    const user = userEvent.setup();
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />
    );
    expect(screen.queryByText('link-progress-modal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^link$/i }));
    expect(screen.getByText('link-progress-modal')).toBeInTheDocument();
  });

  // Brief-required prop-change coverage: without `libraryId` there is no
  // valid `node(id: $libraryId)` for the picker to root on — the modal must
  // not mount at all rather than mount with a broken/empty id.
  it('does not open the link modal when libraryId is undefined', async () => {
    const row = progressRow({ book: null });
    const user = userEvent.setup();
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId={undefined} />
    );
    await user.click(screen.getByRole('button', { name: /^link$/i }));
    expect(screen.queryByText('link-progress-modal')).not.toBeInTheDocument();
  });

  it('shows the orphan hint icon when the book is null', () => {
    const row = progressRow({ book: null });
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} libraryId="lib-1" />
    );
    expect(screen.getByLabelText('Unlinked progress')).toBeInTheDocument();
  });

  it('does not show the orphan hint icon for a resolved book', () => {
    renderWithApollo(
      <MyProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        libraryId="lib-1"
      />
    );
    expect(screen.queryByLabelText('Unlinked progress')).not.toBeInTheDocument();
  });
});
