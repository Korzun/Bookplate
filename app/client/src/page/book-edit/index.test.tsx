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
vi.mock('~/provider/book', () => ({
  useBook: () => [{ id: 'b1', title: 'X' }, false, false, undefined],
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
});
