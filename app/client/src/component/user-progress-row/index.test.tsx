import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBook, type Book } from '~/provider/book';
import { useDeleteUserProgress, useUserProgress } from '~/provider/progress';
import { renderWithProviders } from '~/test-utils';

import { UserProgressRow } from './index';

// vi.mock is hoisted by Vitest regardless of position in file
vi.mock('~/provider/book');
vi.mock('~/provider/progress');

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const mockProgress = { document: 'book-1', percentage: 75, device: 'Kobo', timestamp: 2000 };
const mockBook = { id: 'book-1', title: 'Foundation' } as unknown as Book;

describe('UserProgressRow', () => {
  let mockDelete: (bookId: string) => Promise<void>;

  beforeEach(() => {
    mockDelete = vi.fn<(bookId: string) => Promise<void>>();
    vi.mocked(useBook).mockReturnValue([mockBook, false, false, undefined]);
    vi.mocked(useUserProgress).mockReturnValue([mockProgress, false, false, undefined]);
    vi.mocked(useDeleteUserProgress).mockReturnValue([mockDelete, false, false, undefined]);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders a Clear button when progress is loaded', () => {
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  it('calls deleteUserProgress with bookId when confirmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const buttons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(buttons[buttons.length - 1]);
    expect(mockDelete).toHaveBeenCalledWith('book-1');
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const buttons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
  });

  it('shows an error toast when delete fails', async () => {
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      mockDelete,
      false,
      true,
      'Failed to clear progress',
    ]);
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const buttons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.getByText('Failed to clear progress')).toBeInTheDocument());
  });
});
