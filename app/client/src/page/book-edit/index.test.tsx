import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const navigate = vi.fn();
const dismissAllProposals = vi.fn();
const mockUsePendingFixesForBook = vi.fn();
const mockBookEditForm = vi.fn();

// `useParams().id` deliberately differs from `bookReturn.id` below — a
// Relay global id, standing in for the URL param a future grid→edit link
// would produce (final-branch-review I-3).
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ id: 'global-b1' }),
  useNavigate: () => navigate,
}));
let bookReturn: unknown = { id: 'b1', title: 'X', valid: true };
vi.mock('~/provider/book', () => ({
  useBook: () => [bookReturn, false, false, undefined],
}));
// `~/provider/toast` is left unmocked: `renderWithProviders` supplies a real
// `ToastProvider`, and `errorMessage` is undefined in our fixture so the
// page's toast effect never fires.
const pending = {
  id: '1',
  bookId: 'b1',
  fileName: 'a.epub',
  fileSize: 1,
  status: 'done',
  bytesUploaded: 1,
  proposals: [{}],
};
let pendingReturn: unknown = pending;
vi.mock('~/provider/upload', () => ({
  usePendingFixesForBook: (bookId: string | undefined) => {
    mockUsePendingFixesForBook(bookId);
    return pendingReturn;
  },
  useUploadQueue: () => ({ dismissAllProposals }),
}));
vi.mock('~/component', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BookEditForm: (props: { id: string }) => {
    mockBookEditForm(props);
    return <div>EDIT FORM</div>;
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});
beforeEach(() => {
  navigate.mockClear();
  dismissAllProposals.mockClear();
  mockUsePendingFixesForBook.mockClear();
  mockBookEditForm.mockClear();
  pendingReturn = pending;
  bookReturn = { id: 'b1', title: 'X', valid: true };
});

async function renderPage() {
  const { BookEditPage } = await import('./index');
  return renderWithProviders(<BookEditPage />);
}

describe('BookEditPage fix guard', () => {
  it('shows the guard modal (not the form) when fixes are pending', async () => {
    await renderPage();
    expect(screen.getByText('Review fixes')).toBeTruthy();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
  });
  it('shows the form when no fixes are pending', async () => {
    pendingReturn = undefined;
    await renderPage();
    expect(screen.getByText('EDIT FORM')).toBeTruthy();
  });
  it('shows the blocked message (not the form) when the book is not valid', async () => {
    pendingReturn = undefined;
    bookReturn = { id: 'b1', title: 'X', valid: false };
    await renderPage();
    expect(screen.getByText(/must pass validation/i)).toBeTruthy();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
  });

  // Final-branch-review I-3: the URL param (`useParams().id`, mocked above
  // as `'global-b1'` — standing in for a Relay global id) must never reach
  // `usePendingFixesForBook` or `BookEditForm`'s `id` prop. Both need the
  // RAW id `useBook` already resolved (`bookReturn.id`, `'b1'`) —
  // `usePendingFixesForBook` matches against the upload queue's raw
  // `bookId`, and `BookEditForm` forwards `id` straight into
  // `patchBookMetadata`, which hits `PATCH /api/books/:id/metadata` (a
  // route that does not accept global ids).
  it("calls usePendingFixesForBook and BookEditForm with the book's resolved raw id, not the URL param", async () => {
    pendingReturn = undefined;
    await renderPage();

    expect(mockUsePendingFixesForBook).toHaveBeenCalledWith('b1');
    expect(mockUsePendingFixesForBook).not.toHaveBeenCalledWith('global-b1');
    expect(mockBookEditForm).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('passes undefined to usePendingFixesForBook while the book has not resolved yet', async () => {
    bookReturn = undefined;
    pendingReturn = undefined;
    await renderPage();

    expect(mockUsePendingFixesForBook).toHaveBeenCalledWith(undefined);
  });
});
