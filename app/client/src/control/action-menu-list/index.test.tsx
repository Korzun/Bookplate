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

  it('places danger items after a separator', () => {
    const items: PageActionItem[] = [
      { label: 'Edit metadata', onClick: vi.fn() },
      { label: 'Delete book', onClick: vi.fn(), danger: true },
    ];
    renderWithProviders(<ActionMenuList items={items} surface="glass" onSelect={vi.fn()} />);
    const menu = screen.getByRole('menu');
    // 2 menuitems + 1 separator between the groups
    expect(menu.children).toHaveLength(3);
    expect(screen.getAllByRole('menuitem').map((n) => n.textContent)).toEqual([
      'Edit metadata',
      'Delete book',
    ]);
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
