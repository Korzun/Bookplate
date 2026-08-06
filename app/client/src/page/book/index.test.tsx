import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const GLOBAL_ID = 'Qm9vazpbInUxIiwiZ2xvYmFsLTEiXQ=='; // stands in for a Relay global id
const RAW_ID = 'raw-1';

const navigate = vi.fn();

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ id: GLOBAL_ID }),
  useNavigate: () => navigate,
}));

let bookReturn: unknown = { id: RAW_ID, title: 'Dune', series: '', author: '', subjects: [] };
vi.mock('~/provider/book', () => ({
  useBook: () => [bookReturn, bookReturn === undefined, false, undefined],
  useClearBookEditions: () => [vi.fn(), false, false, undefined],
  useDeleteBook: () => [vi.fn(), false, false, undefined],
  useDownloadBook: () => [vi.fn()],
  useRegenChapters: () => [vi.fn(), false, false, undefined],
  useValidateBook: () => [vi.fn(), false],
}));

vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () =>
    Object.assign((url: string) => url, { ready: true, username: undefined }),
}));

const mockUseMyProgress = vi.fn((_bookId: string | undefined) => [
  undefined,
  false,
  false,
  undefined,
]);
vi.mock('~/provider/progress', () => ({
  useMyProgress: (bookId: string | undefined) => mockUseMyProgress(bookId),
}));

vi.mock('~/lib/use-authorized-src', () => ({
  useAuthorizedSrc: () => undefined,
}));

vi.mock('~/component', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ProgressIndicator: () => <div>progress-indicator</div>,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  MetadataList: () => <div>metadata-list</div>,
}));

vi.mock('~/control', () => ({
  BookLineageModal: () => null,
  ConfirmModal: () => null,
  SetProgressModal: () => null,
  UploadReplaceModal: () => null,
  ValidationDetailModal: () => null,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

beforeEach(() => {
  navigate.mockClear();
  mockUseMyProgress.mockClear();
  bookReturn = { id: RAW_ID, title: 'Dune', series: '', author: '', subjects: [] };
});

async function renderPage() {
  const { BookPage } = await import('./index');
  return renderWithProviders(<BookPage />);
}

describe('BookPage progress lookup', () => {
  // Task 13's review flagged this: `useMyProgress` indexes
  // `myProgressList[bookId]` by the book's RAW local id
  // (`use-fetch-my-progress-list.ts`'s `p.document`), but the URL `id` param
  // is now sometimes a Relay global id (the grid, task 8, navigates with
  // `unmasked.id` — `BookRowFromEntry`). Passing the raw URL param straight
  // through misses that map silently: 0% progress shown for a book the
  // viewer is actually partway through, and `SetProgressModal` opens at
  // chapter 0 instead of their real chapter. A test asserting only "progress
  // renders" could pass against the raw-id path alone and never exercise
  // this — this test pins the actual ARGUMENT `useMyProgress` receives, not
  // just that something renders.
  it("calls useMyProgress with the book's raw id, not the raw URL param", async () => {
    await renderPage();

    expect(mockUseMyProgress).toHaveBeenCalledWith(RAW_ID);
    expect(mockUseMyProgress).not.toHaveBeenCalledWith(GLOBAL_ID);
  });

  it('passes undefined to useMyProgress while the book has not loaded yet', async () => {
    bookReturn = undefined;
    await renderPage();

    expect(mockUseMyProgress).toHaveBeenCalledWith(undefined);
  });
});
