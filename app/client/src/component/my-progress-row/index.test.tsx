import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useUsername } from '~/provider/auth';
import { useBook, type Book } from '~/provider/book';
import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
import { renderWithProviders } from '~/test-utils';

import { MyProgressRow } from './index';

// vi.mock is hoisted by Vitest regardless of position in file
vi.mock('~/provider/auth', () => ({
  useUsername: vi.fn(),
}));
vi.mock('~/provider/book');
vi.mock('~/provider/progress');
vi.mock('~/control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/control')>();
  return {
    ...actual,
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

const mockProgress = { document: 'book-1', percentage: 50, device: 'Kindle', timestamp: 1000 };
const mockBook = { id: 'book-1', title: 'Dune' } as unknown as Book;

describe('MyProgressRow', () => {
  let mockDelete: ReturnType<typeof vi.fn<(bookId: string) => Promise<boolean>>>;

  beforeEach(() => {
    mockDelete = vi.fn<(bookId: string) => Promise<boolean>>().mockResolvedValue(true);
    vi.mocked(useUsername).mockReturnValue(['alice', false]);
    vi.mocked(useBook).mockReturnValue([mockBook, false, false, undefined]);
    vi.mocked(useMyProgress).mockReturnValue([mockProgress, false, false, undefined]);
    vi.mocked(useDeleteMyProgress).mockReturnValue([mockDelete, false, false, undefined]);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders a Clear button when progress is loaded', () => {
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  it('calls deleteMyProgress with bookId when confirmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const clearButtons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(clearButtons[clearButtons.length - 1]);
    expect(mockDelete).toHaveBeenCalledWith('book-1');
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const clearButtons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(clearButtons[clearButtons.length - 1]);
    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
  });

  it('shows an error toast when delete fails', async () => {
    mockDelete.mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const clearButtons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(clearButtons[clearButtons.length - 1]);
    await waitFor(() => expect(screen.getByText('Failed to clear progress')).toBeInTheDocument());
  });

  it('prefers titleSort over title for a resolved book', () => {
    vi.mocked(useBook).mockReturnValue([
      {
        id: 'book-1',
        title: 'The Great Gatsby',
        titleSort: 'Great Gatsby, The',
      } as unknown as Book,
      false,
      false,
      undefined,
    ]);
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    expect(screen.getByText('Great Gatsby, The')).toBeInTheDocument();
    expect(screen.queryByText('The Great Gatsby')).not.toBeInTheDocument();
  });

  it('does not show a Link button for a resolved book', () => {
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    expect(screen.queryByText('Link')).not.toBeInTheDocument();
  });

  it('shows a Link button when the progress is unresolved', () => {
    vi.mocked(useBook).mockReturnValue([
      undefined,
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useBook>);
    vi.mocked(useMyProgress).mockReturnValue([
      { document: 'orphan-id', percentage: 0.5, device: 'Kobo', timestamp: 1000 },
      false,
      false,
      undefined,
    ]);
    renderWithProviders(<MyProgressRow bookId="orphan-id" />);
    expect(screen.getByText('Link')).toBeInTheDocument();
  });

  it('does not show a Link button while the book is loading', () => {
    vi.mocked(useBook).mockReturnValue([undefined, true, false, undefined] as unknown as ReturnType<
      typeof useBook
    >);
    vi.mocked(useMyProgress).mockReturnValue([
      { document: 'orphan-id', percentage: 0.5, device: 'Kobo', timestamp: 1000 },
      false,
      false,
      undefined,
    ]);
    renderWithProviders(<MyProgressRow bookId="orphan-id" />);
    expect(screen.queryByText('Link')).not.toBeInTheDocument();
  });

  it('opens the link modal when Link is clicked', async () => {
    vi.mocked(useBook).mockReturnValue([
      undefined,
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useBook>);
    vi.mocked(useMyProgress).mockReturnValue([
      { document: 'orphan-id', percentage: 0.5, device: 'Kobo', timestamp: 1000 },
      false,
      false,
      undefined,
    ]);
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="orphan-id" />);
    expect(screen.queryByText('link-progress-modal')).not.toBeInTheDocument();
    await user.click(screen.getByText('Link'));
    expect(screen.getByText('link-progress-modal')).toBeInTheDocument();
  });

  it('shows the orphan hint icon when the progress is unresolved', () => {
    vi.mocked(useBook).mockReturnValue([
      undefined,
      false,
      false,
      undefined,
    ] as unknown as ReturnType<typeof useBook>);
    vi.mocked(useMyProgress).mockReturnValue([
      { document: 'orphan-id', percentage: 0.5, device: 'Kobo', timestamp: 1000 },
      false,
      false,
      undefined,
    ]);
    renderWithProviders(<MyProgressRow bookId="orphan-id" />);
    expect(screen.getByLabelText('Unlinked progress')).toBeInTheDocument();
  });

  it('does not show the orphan hint icon for a resolved book', () => {
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    expect(screen.queryByLabelText('Unlinked progress')).not.toBeInTheDocument();
  });
});
