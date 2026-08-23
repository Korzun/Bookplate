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
import {
  MyProgressListDocument,
  ProgressDeleteDocument,
  ProgressRowFragment,
} from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { MyProgressRow } from './index';

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
 * Writes the row into a REAL, normalized `InMemoryCache` (via `writeQuery`,
 * not a bare `cache.writeFragment` shortcut) so `Progress:<id>` genuinely
 * exists as an entity before a delete test runs — otherwise `cache.evict`
 * (inside `useDeleteProgress`) would be evicting nothing, and a test
 * asserting the entity is GONE afterward would pass vacuously whether or
 * not the eviction code ran at all. The `libraryId`/`first` used to key this
 * write are arbitrary: `MyProgressRow` itself never reads this query (it is
 * fetch-free), so nothing else in this test needs them to match anything.
 */
const seedProgressEntity = (client: ApolloClient, row: ProgressRowFragmentFragment) =>
  client.writeQuery({
    query: MyProgressListDocument,
    variables: { libraryId: 'lib-1', first: 50 },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: 'lib-1',
        progress: {
          __typename: 'LibraryProgressConnection',
          edges: [{ __typename: 'LibraryProgressConnectionEdge', cursor: row.id, node: row }],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
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
      <MyProgressRow progress={makeFragmentData(progressRow(), ProgressRowFragment)} />
    );
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(progressRow(), ProgressRowFragment)} />
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  // Fixture-gap requirement: the entity is seeded into a REAL InMemoryCache
  // via `seedProgressEntity`, and `useDeleteProgress` is the REAL hook from
  // `~/provider/library` (not mocked) — so this proves the row wires its
  // unmasked `row.id` (the Relay GLOBAL id) into `deleteProgress`, and that
  // the resulting `progressDelete` mutation's `update` callback actually
  // evicts the entity from the cache. `MockLink` throws on an unmatched
  // operation, so a call carrying the wrong id (e.g. the raw `document`
  // instead of `id`) would fail to match `deleteSuccessMock` and surface as
  // an error here rather than pass silently.
  it('calls deleteProgress with the Progress global id and evicts it from the cache when confirmed', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1', document: 'doc-hash-1' });
    const { client } = renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} />,
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
      <MyProgressRow progress={makeFragmentData(progressRow(), ProgressRowFragment)} />
    );
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    const row = progressRow({ id: 'progress-1' });
    const { client } = renderWithApollo(
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} />,
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
      <MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} />,
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
  // `ProgressRowFragment` (`graphql/progress.ts`, committed, out of scope
  // for this task) selects `book { id title author hasCover thumbnailUrl }`
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
    renderWithApollo(<MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} />);
    expect(screen.getByText('Dune')).toBeInTheDocument();
  });

  // Inapplicable (was "does not show a Link button while the book is
  // loading"): fetch-free rows have no per-row loading state to begin with
  // — `book` arrives already resolved as part of the parent connection page
  // (`use-my-progress-list.ts`), and there is no Link button at all any
  // more (see the null-book test below and its doc comment).
  //
  // Inapplicable (was "shows a Link button when the progress is
  // unresolved" / "opens the link modal when Link is clicked"): the
  // link-to-book workflow (`LinkProgressModal`, wired to the NEW
  // `bookLinkDocument` mutation and `LinkPickerBooksDocument`) is a later
  // task's job per the design spec's §6 — this task only migrates the read
  // (`ProgressRowFragment`) and delete (`progressDelete`) halves of the
  // row, matching the wiring brief's explicit instruction: a null-book row
  // renders "the raw document and no book link" — the exact phrase
  // `ProgressRowFragment`'s own doc comment already uses. Folded into the
  // null-book test below, which asserts no Link button renders either way.
  it('renders a row whose book is null using the raw document, with no book link', () => {
    const row = progressRow({ document: 'orphan-doc-hash', book: null });
    renderWithApollo(<MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} />);
    expect(screen.getByText('orphan-doc-hash')).toBeInTheDocument();
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^link$/i })).not.toBeInTheDocument();
  });

  it('does not show a Link button for a resolved book', () => {
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(progressRow(), ProgressRowFragment)} />
    );
    expect(screen.queryByRole('button', { name: /^link$/i })).not.toBeInTheDocument();
  });

  it('shows the orphan hint icon when the book is null', () => {
    const row = progressRow({ book: null });
    renderWithApollo(<MyProgressRow progress={makeFragmentData(row, ProgressRowFragment)} />);
    expect(screen.getByLabelText('Unlinked progress')).toBeInTheDocument();
  });

  it('does not show the orphan hint icon for a resolved book', () => {
    renderWithApollo(
      <MyProgressRow progress={makeFragmentData(progressRow(), ProgressRowFragment)} />
    );
    expect(screen.queryByLabelText('Unlinked progress')).not.toBeInTheDocument();
  });
});
