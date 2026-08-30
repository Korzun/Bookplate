import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type { BookRequestRowFragmentFragment, BookRequestStatus } from '~/gql/graphql';
import { BookRequestRowFragment } from '~/graphql/book-request';
import { path } from '~/router';
import { renderWithProviders } from '~/test-utils';

import { BookRequestRow } from './index';

/**
 * A typed `BookRequestRowFragmentFragment` VARIABLE, never an inline object
 * literal at a call site — mirrors `component/user-row/index.test.tsx`'s
 * `user()` helper: a fresh literal fails TypeScript's excess-property check
 * against `BookRequestRow`'s MASKED `request` prop, and `makeFragmentData`
 * is the sanctioned cast back to that masked type.
 */
const requestRow = (
  overrides: Partial<{
    id: string;
    title: string;
    author: string;
    note: string;
    status: BookRequestStatus;
    declineReason: string;
    book: { id: string; title: string } | null;
  }> = {}
): BookRequestRowFragmentFragment => ({
  __typename: 'BookRequest',
  id: overrides.id ?? 'req-1',
  title: overrides.title ?? 'Dune',
  author: overrides.author ?? 'Frank Herbert',
  note: overrides.note ?? '',
  status: overrides.status ?? 'PENDING',
  declineReason: overrides.declineReason ?? '',
  createdAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  book:
    overrides.book !== undefined
      ? overrides.book && { __typename: 'Book', ...overrides.book }
      : null,
});

const renderRow = (
  overrides: Parameters<typeof requestRow>[0] = {},
  props: { canResolve?: boolean; onDelete?: (id: string) => void } = {}
) => {
  const onDelete = props.onDelete ?? vi.fn();
  const rendered = renderWithProviders(
    <BookRequestRow
      request={makeFragmentData(requestRow(overrides), BookRequestRowFragment)}
      canResolve={props.canResolve ?? false}
      onDelete={onDelete}
    />
  );
  return { ...rendered, onDelete };
};

describe('BookRequestRow', () => {
  it('shows title, author and a pending state', () => {
    renderRow({ status: 'PENDING', title: 'Dune', author: 'Frank Herbert' });
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText(/Frank Herbert/)).toBeInTheDocument();
    expect(screen.getByText(/Pending/i)).toBeInTheDocument();
  });

  it('links to the book once fulfilled, through path.book (not a hand-rolled /book/<id>)', () => {
    // The id below carries `+` and `/` — legal bytes in a base64 Relay
    // global id — specifically so this test can tell a correctly-encoded
    // `path.book(id)` href apart from a naively-templated one: an
    // un-encoded `/book/${id}` would produce a DIFFERENT (and broken) path
    // segment for this id, not just a differently-prefixed one.
    const bookId = 'Qm9vaz+ox/1==';
    renderRow({ status: 'FULFILLED', book: { id: bookId, title: 'Dune' } });
    expect(screen.getByRole('link', { name: /Dune/ })).toHaveAttribute('href', path.book(bookId));
  });

  it('says the book was added even when the link is gone', () => {
    renderRow({ status: 'FULFILLED', book: null });
    expect(screen.getByText(/added to your library/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the decline reason when there is one', () => {
    renderRow({ status: 'DECLINED', declineReason: "Couldn't find a copy" });
    expect(screen.getByText(/Couldn't find a copy/)).toBeInTheDocument();
  });

  it('offers no resolve actions when canResolve is false', () => {
    renderRow({ status: 'PENDING' }, { canResolve: false });
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });

  it('calls onDelete with the row id, labelled Withdraw while pending', async () => {
    const onDelete = vi.fn();
    renderRow({ status: 'PENDING', id: 'req-42' }, { onDelete });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /withdraw/i }));

    expect(onDelete).toHaveBeenCalledWith('req-42');
  });

  it('labels the delete control Clear once resolved', () => {
    renderRow({ status: 'FULFILLED', book: null });
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });
});
