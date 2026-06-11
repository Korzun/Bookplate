import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsAdmin } from '~/provider/auth';
import { useBook, type Book } from '~/provider/book';
import { useUserProgress, useDeleteUserProgress } from '~/provider/progress';
import { renderWithProviders } from '~/test-utils';

import { UserProgressRow } from './index';

vi.mock('~/provider/auth', () => ({
  useIsAdmin: vi.fn(),
}));
vi.mock('~/provider/book', () => ({
  useBook: vi.fn(),
}));
vi.mock('~/provider/progress', () => ({
  useUserProgress: vi.fn(),
  useDeleteUserProgress: vi.fn(),
}));
vi.mock('~/control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/control')>();
  return {
    ...actual,
    LinkProgressModal: () => null,
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

const mockProgress = {
  document: 'orphan-id',
  percentage: 0.5,
  device: 'Kobo',
  timestamp: 1000,
};

describe('UserProgressRow — Link button visibility', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows Link button for admin when book is unresolved (not loading)', () => {
    vi.mocked(useIsAdmin).mockReturnValue([true, false] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([
      undefined,
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useBook>);
    vi.mocked(useUserProgress).mockReturnValue([
      mockProgress,
      false,
      false,
      undefined,
    ] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      vi.fn<(bookId: string) => Promise<boolean>>().mockResolvedValue(true),
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useDeleteUserProgress>);

    renderWithProviders(<UserProgressRow bookId="orphan-id" username="alice" />);
    // Button renders a <div>, not a <button> element — query by text content
    expect(screen.getByText('Link')).toBeDefined();
  });

  it('does not show Link button while book is loading', () => {
    vi.mocked(useIsAdmin).mockReturnValue([true, false] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([undefined, true, false, undefined] as ReturnType<
      typeof useBook
    >);
    vi.mocked(useUserProgress).mockReturnValue([
      mockProgress,
      false,
      false,
      undefined,
    ] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      vi.fn<(bookId: string) => Promise<boolean>>().mockResolvedValue(true),
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useDeleteUserProgress>);

    renderWithProviders(<UserProgressRow bookId="orphan-id" username="alice" />);
    expect(screen.queryByText('Link')).toBeNull();
  });

  it('does not show Link button for non-admin', () => {
    vi.mocked(useIsAdmin).mockReturnValue([false, false] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([
      undefined,
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useBook>);
    vi.mocked(useUserProgress).mockReturnValue([
      mockProgress,
      false,
      false,
      undefined,
    ] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      vi.fn<(bookId: string) => Promise<boolean>>().mockResolvedValue(true),
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useDeleteUserProgress>);

    renderWithProviders(<UserProgressRow bookId="orphan-id" username="alice" />);
    expect(screen.queryByText('Link')).toBeNull();
  });

  it('does not show Link button when the book exists', () => {
    const book = {
      id: 'known-book',
      title: 'Known Book',
      author: 'Author',
      fileAs: '',
      series: '',
      seriesIndex: 0,
      subjects: [],
      identifiers: [],
      hasCover: false,
      size: 0,
      chapterCount: 0,
      pageCount: 0,
    };
    vi.mocked(useIsAdmin).mockReturnValue([true, false] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([book, false, false, undefined] as ReturnType<
      typeof useBook
    >);
    vi.mocked(useUserProgress).mockReturnValue([
      { ...mockProgress, document: 'known-book' },
      false,
      false,
      undefined,
    ] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      vi.fn<(bookId: string) => Promise<boolean>>().mockResolvedValue(true),
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useDeleteUserProgress>);

    renderWithProviders(<UserProgressRow bookId="known-book" username="alice" />);
    expect(screen.queryByText('Link')).toBeNull();
  });
});

describe('UserProgressRow — Clear functionality', () => {
  const mockBook = { id: 'book-1', title: 'Foundation' } as unknown as Book;
  const mockProgressBook = { document: 'book-1', percentage: 75, device: 'Kobo', timestamp: 2000 };

  let mockDelete: ReturnType<typeof vi.fn<(bookId: string) => Promise<boolean>>>;

  beforeEach(() => {
    mockDelete = vi.fn<(bookId: string) => Promise<boolean>>().mockResolvedValue(true);
    vi.mocked(useIsAdmin).mockReturnValue([false, false] as ReturnType<typeof useIsAdmin>);
    vi.mocked(useBook).mockReturnValue([mockBook, false, false, undefined] as ReturnType<
      typeof useBook
    >);
    vi.mocked(useUserProgress).mockReturnValue([
      mockProgressBook,
      false,
      false,
      undefined,
    ] as ReturnType<typeof useUserProgress>);
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      mockDelete,
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useDeleteUserProgress>);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders a Clear button when progress is loaded', () => {
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    expect(screen.getByText('Clear')).toBeDefined();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByText('Clear'));
    expect(screen.getByText(/clear reading progress\?/i)).toBeDefined();
  });

  it('calls deleteUserProgress with bookId when confirmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByText('Clear'));
    const clearButtons = screen.getAllByText('Clear');
    await user.click(clearButtons[clearButtons.length - 1]);
    expect(mockDelete).toHaveBeenCalledWith('book-1');
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByText('Clear'));
    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText(/clear reading progress\?/i)).toBeNull();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByText('Clear'));
    const clearButtons = screen.getAllByText('Clear');
    await user.click(clearButtons[clearButtons.length - 1]);
    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeDefined());
  });

  it('shows an error toast when delete fails', async () => {
    mockDelete.mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByText('Clear'));
    const clearButtons = screen.getAllByText('Clear');
    await user.click(clearButtons[clearButtons.length - 1]);
    await waitFor(() => expect(screen.getByText('Failed to clear progress')).toBeDefined());
  });
});
