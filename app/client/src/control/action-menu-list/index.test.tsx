import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ActionMenuList, type PageActionItem } from './index';

describe('ActionMenuList', () => {
  it('renders items and calls onSelect with the clicked item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items: PageActionItem[] = [
      { label: 'Edit metadata', onClick: vi.fn() },
      { label: 'Regen chapters', onClick: vi.fn() },
    ];
    renderWithProviders(<ActionMenuList items={items} surface="solid" onSelect={onSelect} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Edit metadata' }));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('renders a separator before an item flagged separatorBefore, preserving source order', () => {
    const items: PageActionItem[] = [
      { label: 'Edit metadata', onClick: vi.fn() },
      { label: 'Delete book', onClick: vi.fn(), danger: true, separatorBefore: true },
    ];
    renderWithProviders(<ActionMenuList items={items} surface="glass" onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    // 2 menuitems + 1 separator between them
    expect(menu.children).toHaveLength(3);
    expect(screen.getAllByRole('menuitem').map((n) => n.textContent)).toEqual([
      'Edit metadata',
      'Delete book',
    ]);
  });

  it('does not separate a danger item unless separatorBefore is set', () => {
    const items: PageActionItem[] = [
      { label: 'Accept all', onClick: vi.fn() },
      { label: 'Reject all', onClick: vi.fn(), danger: true },
    ];
    renderWithProviders(<ActionMenuList items={items} surface="glass" onSelect={vi.fn()} />);
    // danger drives styling only now — no divider without an explicit flag.
    expect(screen.getByRole('menu').children).toHaveLength(2);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('ignores separatorBefore on the first item (no leading divider)', () => {
    const items: PageActionItem[] = [
      { label: 'Clear finished', onClick: vi.fn(), separatorBefore: true },
      { label: 'Accept all', onClick: vi.fn() },
    ];
    renderWithProviders(<ActionMenuList items={items} surface="glass" onSelect={vi.fn()} />);
    expect(screen.getByRole('menu').children).toHaveLength(2);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('does not fire onSelect for a disabled item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items: PageActionItem[] = [
      { label: 'Clear device editions (0)', onClick: vi.fn(), disabled: true },
    ];
    renderWithProviders(<ActionMenuList items={items} surface="solid" onSelect={onSelect} />);
    await user.click(screen.getByRole('menuitem', { name: 'Clear device editions (0)' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
