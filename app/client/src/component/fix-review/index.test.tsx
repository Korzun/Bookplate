import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MetadataFix } from '~/lib/book-types';
import { renderWithProviders } from '~/test-utils';

import { FixReview } from './index';

const autoFix: MetadataFix = {
  field: 'author',
  kind: 'author-inverted',
  from: 'Watts, Peter',
  to: 'Peter Watts',
  changes: { author: 'Peter Watts' },
};

const actionableProposal: MetadataFix = {
  field: 'authorSort',
  kind: 'author-sort-missing',
  from: '',
  to: 'Guin, Ursula K. Le',
  changes: { authorSort: 'Guin, Ursula K. Le' },
};

const flagOnlyProposal: MetadataFix = {
  field: 'title',
  kind: 'title-is-filename',
  from: 'book',
  to: null,
  changes: {},
};

const noop = {
  onApplyFix: () => {},
  onApplyAll: () => {},
  onDismissAll: () => {},
  onDismissFix: () => {},
};

describe('FixReview', () => {
  it('renders the auto fix under "Automatic fixes"', () => {
    renderWithProviders(
      <FixReview autoFixes={[autoFix]} appliedFixes={[]} proposals={[]} {...noop} />
    );
    expect(screen.getByText('Automatic fixes')).toBeInTheDocument();
    expect(screen.getByText('Watts, Peter')).toBeInTheDocument();
    expect(screen.getByText('Peter Watts')).toBeInTheDocument();
  });

  it('renders a proposal row and fires onApplyFix / onDismissFix', () => {
    const onApplyFix = vi.fn();
    const onDismissFix = vi.fn();
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[actionableProposal]}
        {...noop}
        onApplyFix={onApplyFix}
        onDismissFix={onDismissFix}
      />
    );
    expect(screen.getByText('Author sort:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(onApplyFix).toHaveBeenCalledWith(actionableProposal);
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(onDismissFix).toHaveBeenCalledWith(actionableProposal);
  });

  it('fires onApplyAll from Accept all', () => {
    const onApplyAll = vi.fn();
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[actionableProposal, flagOnlyProposal]}
        {...noop}
        onApplyAll={onApplyAll}
        bookGlobalId="abc"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }));
    expect(onApplyAll).toHaveBeenCalled();
  });

  it('fires onDismissAll from Reject all', () => {
    const onDismissAll = vi.fn();
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[actionableProposal, flagOnlyProposal]}
        {...noop}
        onDismissAll={onDismissAll}
        bookGlobalId="abc"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /reject all/i }));
    expect(onDismissAll).toHaveBeenCalled();
  });

  it('a to===null proposal shows "needs review" with an Edit link by default', () => {
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[flagOnlyProposal]}
        {...noop}
        bookGlobalId="abc"
      />
    );
    expect(screen.getByText('needs review')).toBeInTheDocument();
    const editLink = screen.getByRole('link', { name: /edit/i });
    expect(editLink).toHaveAttribute('href', expect.stringContaining('abc'));
  });

  it('with showEditLink={false}, a to===null proposal shows "needs review" and NO Edit link', () => {
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[flagOnlyProposal]}
        {...noop}
        bookGlobalId="abc"
        showEditLink={false}
      />
    );
    expect(screen.getByText('needs review')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit/i })).toBeNull();
  });

  it('renders only Undo when a snapshot is pending', () => {
    const onUndo = vi.fn();
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[]}
        {...noop}
        onUndo={onUndo}
        undo={{ kind: 'dismiss' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^undo reject$/i }));
    expect(onUndo).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /accept all/i })).not.toBeInTheDocument();
  });

  it('disables every accept/reject control when disabled is set', () => {
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[actionableProposal, flagOnlyProposal]}
        {...noop}
        bookGlobalId="abc"
        disabled
      />
    );
    expect(screen.getByRole('button', { name: /^accept$/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('button', { name: /accept all/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('disables Undo while its action is in flight and ignores a second click', async () => {
    let resolve!: () => void;
    const onUndo = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[]}
        {...noop}
        onUndo={onUndo}
        undo={{ kind: 'apply' }}
      />
    );
    const undoBtn = screen.getByRole('button', { name: /^undo accept$/i });
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(undoBtn).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
    });
    await waitFor(() => expect(undoBtn).not.toHaveAttribute('aria-disabled'));
  });

  it('renders nothing when there are no fixes, proposals, or pending undo', () => {
    const { container } = renderWithProviders(
      <FixReview autoFixes={[]} appliedFixes={[]} proposals={[]} {...noop} />
    );
    expect(container.textContent).toBe('');
  });
});
