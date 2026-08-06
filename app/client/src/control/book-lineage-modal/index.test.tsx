import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { useBookLineage } from '~/provider/book/hook/use-book-lineage';
import { renderWithApollo } from '~/test-utils';

import { BookLineageModal } from './index';

vi.mock('~/provider/book/hook/use-book-lineage');

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const refetch = vi.fn();

describe('BookLineageModal', () => {
  it('shows a loading state', () => {
    vi.mocked(useBookLineage).mockReturnValue([undefined, true, false, refetch]);
    renderWithApollo(<BookLineageModal isOpen bookId="book-1" onClose={vi.fn()} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('explains what book lineage is', () => {
    vi.mocked(useBookLineage).mockReturnValue([undefined, true, false, refetch]);
    renderWithApollo(<BookLineageModal isOpen bookId="book-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Lineage maps former IDs to this book/i)).toBeInTheDocument();
  });

  it('shows an error state', () => {
    vi.mocked(useBookLineage).mockReturnValue([undefined, false, true, refetch]);
    renderWithApollo(<BookLineageModal isOpen bookId="book-1" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load lineage.')).toBeInTheDocument();
  });

  it('renders the current and edited lineage rows when loaded', () => {
    vi.mocked(useBookLineage).mockReturnValue([
      {
        currentId: 'doc-current',
        entries: [{ oldId: 'doc-old', newId: 'doc-current', timestamp: 1000, type: 'edit' }],
      },
      false,
      false,
      refetch,
    ]);
    renderWithApollo(<BookLineageModal isOpen bookId="book-1" addedAt={500} onClose={vi.fn()} />);
    expect(screen.getByText('doc-current')).toBeInTheDocument();
    expect(screen.getByText('doc-old')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn();
    vi.mocked(useBookLineage).mockReturnValue([undefined, true, false, refetch]);
    renderWithApollo(<BookLineageModal isOpen bookId="book-1" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a merge row for a merge lineage entry', () => {
    vi.mocked(useBookLineage).mockReturnValue([
      {
        currentId: 'doc-current',
        entries: [
          { oldId: 'doc-old', newId: 'doc-current', timestamp: 1000, type: 'edit' },
          { oldId: 'doc-merged', newId: 'doc-current', timestamp: 900, type: 'merge' },
        ],
      },
      false,
      false,
      refetch,
    ]);
    renderWithApollo(<BookLineageModal isOpen bookId="book-1" addedAt={500} onClose={vi.fn()} />);
    expect(screen.getByText('doc-merged')).toBeInTheDocument();
  });

  it('calls onClose when the dialog backdrop is clicked', () => {
    const onClose = vi.fn();
    vi.mocked(useBookLineage).mockReturnValue([undefined, true, false, refetch]);
    const { container } = renderWithApollo(
      <BookLineageModal isOpen bookId="book-1" onClose={onClose} />
    );
    const dialogEl = container.querySelector('dialog');
    expect(dialogEl).not.toBeNull();
    fireEvent.click(dialogEl as HTMLDialogElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
