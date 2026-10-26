import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
  onEditFix: () => Promise.resolve(true),
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

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
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /reject all/i }));
    expect(onDismissAll).toHaveBeenCalled();
  });

  it('a to===null proposal shows "needs review" with an Edit button that opens the edit modal', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FixReview autoFixes={[]} appliedFixes={[]} proposals={[flagOnlyProposal]} {...noop} />
    );
    expect(screen.getByText('needs review')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(screen.getByRole('textbox', { hidden: true })).toHaveValue('book');
  });

  it('with showEdit={false}, a to===null proposal shows "needs review" and NO Edit button', () => {
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[flagOnlyProposal]}
        {...noop}
        showEdit={false}
      />
    );
    expect(screen.getByText('needs review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
  });

  it('saving from the edit modal fires onEditFix with the flagged fix and the typed value', async () => {
    const user = userEvent.setup();
    const onEditFix = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[flagOnlyProposal]}
        {...noop}
        onEditFix={onEditFix}
      />
    );

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const input = screen.getByRole('textbox', { hidden: true });
    await user.clear(input);
    await user.type(input, 'A Real Title');
    await user.click(screen.getByRole('button', { name: 'Save', hidden: true }));

    expect(onEditFix).toHaveBeenCalledWith(flagOnlyProposal, 'A Real Title');
  });

  it('"Keep as is" in the edit modal fires onDismissFix with the flagged fix', async () => {
    const user = userEvent.setup();
    const onDismissFix = vi.fn();
    renderWithProviders(
      <FixReview
        autoFixes={[]}
        appliedFixes={[]}
        proposals={[flagOnlyProposal]}
        {...noop}
        onDismissFix={onDismissFix}
      />
    );

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('button', { name: 'Keep as is', hidden: true }));

    expect(onDismissFix).toHaveBeenCalledWith(flagOnlyProposal);
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
