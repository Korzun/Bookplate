import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBook } from '~/provider/book';
import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
import { renderWithProviders } from '~/test-utils';

import { MyProgressRow } from './index';

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

const mockProgress = { document: 'book-1', percentage: 50, device: 'Kindle', timestamp: 1000 };
const mockBook = { id: 'book-1', title: 'Dune' };

describe('MyProgressRow', () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDelete = vi.fn();
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
    vi.mocked(useDeleteMyProgress).mockReturnValue([
      mockDelete,
      false,
      true,
      'Failed to clear progress',
    ]);
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    const clearButtons = screen.getAllByRole('button', { name: /^clear$/i });
    await user.click(clearButtons[clearButtons.length - 1]);
    await waitFor(() => expect(screen.getByText('Failed to clear progress')).toBeInTheDocument());
  });
});
