import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { PageFooterActions, type FooterAction } from './index';

function makeItems(): FooterAction[] {
  return [
    { label: 'Cancel', onClick: vi.fn(), align: 'leading' },
    { label: 'Save', onClick: vi.fn(), emphasis: true },
  ];
}

describe('PageFooterActions', () => {
  it('renders leading items before trailing items', () => {
    renderWithProviders(<PageFooterActions items={makeItems()} />);
    const names = screen.getAllByRole('button').map((n) => n.textContent);
    expect(names).toEqual(['Cancel', 'Save']);
  });

  it('calls onClick when a button is activated', async () => {
    const user = userEvent.setup();
    const items = makeItems();
    renderWithProviders(<PageFooterActions items={items} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(items[1].onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick for a disabled item', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <PageFooterActions items={[{ label: 'Save', onClick, disabled: true }]} />
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks a loading item as non-interactive', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <PageFooterActions items={[{ label: 'Saving…', onClick, loading: true }]} />
    );
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
