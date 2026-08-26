import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ProgressRowFragment } from '~/component/my-progress-row';
import { makeFragmentData } from '~/gql';
import type {
  ProgressDeleteMutation,
  ProgressDeleteMutationVariables,
  ProgressRowFragmentFragment,
} from '~/gql/graphql';
import { ProgressDeleteDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { UserProgressRow } from './index';

// `LinkProgressModal`'s own internals (Task 6, GraphQL-backed) have their own
// dedicated test file (`control/link-progress-modal/index.test.tsx`) —
// stubbed here exactly like `MyProgressRow`'s own test file does, so these
// tests exercise only the OPENER this row owns (the `Button` + `showLinkModal`
// state + the `libraryId`/`progressId` props it passes).
//
// Deliberately NOT `importOriginal()` (an earlier version of this mock did):
// `~/control`'s barrel re-exports `SetProgressModal`
// (`control/set-progress-modal`), which imports `useSetMyProgress`/
// `useDeleteProgress` from `~/provider/library` — a chain that reaches
// `~/provider/library-target` (via `use-library-entries.ts`), which reaches
// `component/user-row` (via `use-with-target-user.ts`'s `UserRowFragment`
// import — a pre-existing, KEPT-provider layering choice, out of this
// task's scope to restructure), which reaches THIS component's own family
// (`user-row-content` -> `user-progress-row` -> `my-progress-row`) — a
// genuine circular import back to `~/control` itself. `importOriginal()`
// forces that whole real subtree to resolve before the mock settles, and
// Vitest's module cache ends up binding this row's OWN `~/control` import
// to the REAL (unmocked) module instead — this row's `LinkProgressModal`
// then renders for real, and "opens the link modal when Link is clicked"
// fails because the stub text never appears (seen-to-fail: restoring
// `importOriginal()` reproduces this exact failure). `Button`/`ConfirmModal`
// are pulled from their own leaf subpaths instead — neither imports
// `~/provider/library` or anything else that could re-enter this cycle.
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
 * literal at the call site — mirrors `my-progress-row/index.test.tsx`'s
 * `progressRow` helper exactly; see that file's doc comment for why a
 * variable (not a fresh literal) is what avoids TypeScript's excess-property
 * check against `UserProgressRow`'s masked `progress` prop.
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
 * entity before a delete test runs — the same fixture-gap fix
 * `my-progress-row/index.test.tsx`'s `seedProgressEntity` makes.
 *
 * Deliberately NOT `client.writeQuery(UserProgressListDocument, ...)` (an
 * earlier version of this helper did, and `my-progress-row`'s own
 * `seedProgressEntity` doc comment explains the mechanism in full): that
 * document is declared on `component/user-row-content`, which imports
 * `Button` from `~/control` — pulling `~/control` into this test file's
 * graph a SECOND way that, combined with this file's own
 * `vi.mock('~/control', importOriginal)` below, silently re-binds this row
 * to the REAL `LinkProgressModal` instead of the stub via a circular
 * `~/component` barrel re-entry. `writeFragment` needs only
 * `ProgressRowFragment` (imported from `~/component/my-progress-row`
 * above), which does not trigger the same cycle on its own.
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

describe('UserProgressRow', () => {
  // Ported from "renders a Clear button when progress is loaded".
  it('renders a Clear button when progress is loaded', () => {
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  // Ported as-is.
  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  // Replaces "calls deleteUserProgress with bookId when confirmed" — the
  // REST hook took a raw `bookId`; `useDeleteProgress` takes the row's
  // Relay GLOBAL `Progress.id` instead (brief-required test: "deletes using
  // the row's Progress id"). Fixture-gap requirement: the entity is seeded
  // into a REAL InMemoryCache via `seedProgressEntity`, and
  // `useDeleteProgress` is the REAL hook from `~/provider/library` (not
  // mocked) — so this proves the row wires its unmasked `row.id` into
  // `deleteProgress`, and that the resulting `progressDelete` mutation's
  // `update` callback actually evicts the entity from the cache. `MockLink`
  // throws on an unmatched operation, so a call carrying the wrong id (e.g.
  // the raw `document` instead of `id`) would fail to match
  // `deleteSuccessMock` and surface as an error here rather than pass
  // silently.
  it("deletes using the row's Progress id and evicts it from the cache when confirmed", async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1', document: 'doc-hash-1' });
    const { client } = renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />,
      { mocks: [deleteSuccessMock('progress-1')] }
    );
    seedProgressEntity(client, row);

    await clickConfirmClear(user);

    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(extracted['Progress:progress-1']).toBeUndefined();
  });

  // Ported as-is.
  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
  });

  // Ported as-is.
  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1' });
    const { client } = renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />,
      { mocks: [deleteSuccessMock('progress-1')] }
    );
    seedProgressEntity(client, row);

    await clickConfirmClear(user);

    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
  });

  // Ported as-is, extended with the fixture-gap cache assertion (mirrors
  // `my-progress-row/index.test.tsx`): a failed delete must leave the
  // entity untouched, not just fire a toast.
  it('shows an error toast when delete fails', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1' });
    const { client } = renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />,
      { mocks: [deleteErrorMock('progress-1')] }
    );
    seedProgressEntity(client, row);

    await clickConfirmClear(user);

    await waitFor(() => expect(screen.getByText('Failed to clear progress')).toBeInTheDocument());
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(extracted['Progress:progress-1']).toBeDefined();
  });

  // Replaces "prefers titleSort over title" AND "falls back to title when
  // titleSort is empty" — collapsed into one test, same reasoning as
  // `my-progress-row/index.test.tsx`'s identical collapse: `ProgressRowFragment`
  // (`graphql/progress.ts`, committed, out of scope for this task) selects
  // `book { id title author hasCover thumbnailUrl }` — no `titleSort` field
  // at all any more, so there is nothing left to prefer OR fall back from.
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
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.getByText('Dune')).toBeInTheDocument();
  });

  // Brief-required new case: `Progress.book` is NULLABLE — a device syncs
  // progress for documents not in this library, and that row still renders,
  // using the raw `document` hash in place of a title.
  it('renders a row whose book is null using the raw document', () => {
    const row = progressRow({ document: 'orphan-doc-hash', book: null });
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.getByText('orphan-doc-hash')).toBeInTheDocument();
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
  });

  // Replaces "shows Link button for admin when book is unresolved (not
  // loading)" — the admin-specific gate (`isAdmin`) is gone (see next case's
  // comment for why); what remains is exactly `MyProgressRow`'s "shows a
  // Link button when the book is null" case.
  it('shows a Link button when the book is null', () => {
    const row = progressRow({ book: null });
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument();
  });

  // Ported (adapted): "does not show Link button when the book exists".
  it('does not show a Link button for a resolved book', () => {
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.queryByRole('button', { name: /^link$/i })).not.toBeInTheDocument();
  });

  // Inapplicable ("does not show Link button while book is loading"):
  // fetch-free rows have no per-row loading state at all — `book` arrives
  // already resolved (or genuinely `null`) as part of the parent
  // connection page (`use-user-progress-list.ts`), so there is no
  // intermediate "still resolving" state for the button to be gated
  // against. Same reasoning as `MyProgressRow`'s identical omission.

  // Inapplicable ("does not show Link button for non-admin"): this
  // component is fetch-free and renders NOTHING (no rows at all, let alone
  // an unresolved one) unless `useUserProgressList`'s `Query.user(id:)`
  // query actually succeeded — and that query is admin-only server-side
  // (schema-verified, `graphql/progress.ts`'s doc comment on
  // `UserProgressListDocument`), refusing even a non-admin's OWN id. A
  // non-admin therefore can never reach a state where this row exists at
  // all, let alone one with an unresolved book — there is no reachable code
  // path left for a client-side `isAdmin` gate to guard against, unlike the
  // REST version where a non-admin viewing this screen still received real
  // per-row data and the client-side check was the ONLY thing hiding the
  // button. This is not the "removed the affordance" mistake the brief
  // warns about (design spec §6 assigns the modal's internals to a later
  // task, not this opener) — it is a redundant client-side check made moot
  // by a server-side gate one level up, structurally verified above, not
  // merely assumed away.

  it('opens the link modal when Link is clicked', async () => {
    const row = progressRow({ book: null });
    const user = userEvent.setup();
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
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
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId={undefined}
      />
    );
    await user.click(screen.getByRole('button', { name: /^link$/i }));
    expect(screen.queryByText('link-progress-modal')).not.toBeInTheDocument();
  });

  // Ported as-is.
  it('shows the orphan hint icon when the book is null', () => {
    const row = progressRow({ book: null });
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(row, ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.getByLabelText('Unlinked progress')).toBeInTheDocument();
  });

  // Ported as-is.
  it('does not show the orphan hint icon for a resolved book', () => {
    renderWithApollo(
      <UserProgressRow
        progress={makeFragmentData(progressRow(), ProgressRowFragment)}
        username="alice"
        libraryId="lib-1"
      />
    );
    expect(screen.queryByLabelText('Unlinked progress')).not.toBeInTheDocument();
  });
});
