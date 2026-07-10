import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { PageActionsMenu, type PageActionItem } from './index';

function makeItems(overrides: Partial<PageActionItem> = {}): PageActionItem[] {
  return [
    { label: 'Edit metadata', onClick: vi.fn() },
    { label: 'Delete book', onClick: vi.fn(), danger: true, ...overrides },
  ];
}

describe('PageActionsMenu', () => {
  it('is closed initially — trigger present, no menu', () => {
    renderWithProviders(<PageActionsMenu items={makeItems()} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the menu and lists the items when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PageActionsMenu items={makeItems()} />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit metadata' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete book' })).toBeInTheDocument();
  });

  it('calls the item onClick and closes the menu when an item is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const items: PageActionItem[] = [{ label: 'Edit metadata', onClick }];
    renderWithProviders(<PageActionsMenu items={items} />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit metadata' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not call onClick for a disabled item', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const items: PageActionItem[] = [{ label: 'Regen chapters', onClick, disabled: true }];
    renderWithProviders(<PageActionsMenu items={items} />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Regen chapters' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PageActionsMenu items={makeItems()} />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div>
        <PageActionsMenu items={makeItems()} />
        <button type="button">outside</button>
      </div>
    );
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
