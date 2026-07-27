import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const navigate = vi.fn();
const dismissAllProposals = vi.fn();

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ id: 'b1' }),
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
  usePendingFixesForBook: () => pendingReturn,
  useUploadQueue: () => ({ dismissAllProposals }),
}));
vi.mock('~/component', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BookEditForm: () => <div>EDIT FORM</div>,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});
beforeEach(() => {
  navigate.mockClear();
  dismissAllProposals.mockClear();
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
});
