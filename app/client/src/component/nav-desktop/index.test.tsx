import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookIcon, SettingsIcon, UploadIcon } from '~/icon';
import { renderWithProviders } from '~/test-utils';

import type { NavItem } from '../nav/types';
import { NavDesktop } from './index';

const items: NavItem[] = [
  { to: '/library', label: 'Library', Icon: BookIcon, active: true },
  { to: '/add', label: 'Add', Icon: UploadIcon, active: false },
  { to: '/user', label: 'Settings', Icon: SettingsIcon, active: false },
];

const linkFor = (label: string) => screen.getByText(label).closest('a');

describe('NavDesktop', () => {
  it('renders a link for every item', () => {
    renderWithProviders(<NavDesktop items={items} />);
    expect(linkFor('Library')).toHaveAttribute('href', '/library');
    expect(linkFor('Add')).toHaveAttribute('href', '/add');
    expect(linkFor('Settings')).toHaveAttribute('href', '/user');
  });

  it('marks only the active item with aria-current', () => {
    renderWithProviders(<NavDesktop items={items} />);
    expect(linkFor('Library')).toHaveAttribute('aria-current', 'page');
    expect(linkFor('Add')).not.toHaveAttribute('aria-current');
    expect(linkFor('Settings')).not.toHaveAttribute('aria-current');
  });

  it('renders no background noise overlay', () => {
    const { container } = renderWithProviders(<NavDesktop items={items} />);
    expect(container.querySelector('#nav-desktop-noise')).toBeNull();
  });
});

function badgeItems(badge: NavItem['badge']): NavItem[] {
  return [{ to: '/add', label: 'Add', Icon: UploadIcon, active: false, badge }];
}

describe('NavDesktop badge', () => {
  it('renders the count when badge is a positive number', () => {
    renderWithProviders(<NavDesktop items={badgeItems(3)} />);
    expect(screen.getByText('3')).toBeTruthy();
  });
  it('renders a dot (no number) when badge is "dot"', () => {
    renderWithProviders(<NavDesktop items={badgeItems('dot')} />);
    expect(screen.getByTestId('nav-badge-dot')).toBeTruthy();
  });
  it('renders nothing when badge is undefined', () => {
    renderWithProviders(<NavDesktop items={badgeItems(undefined)} />);
    expect(screen.queryByTestId('nav-badge-dot')).toBeNull();
  });
});

/**
 * An app-style badge sits on the ICON's upper-right corner, which it can only
 * do if it shares a positioned wrapper with the icon. Asserting the shared
 * parent pins the structure the CSS depends on — a badge that drifted back out
 * to the item level would still render, and a text-only assertion would not
 * notice.
 */
describe('NavDesktop badge placement', () => {
  it('puts the count in a wrapper holding the icon and nothing else', () => {
    renderWithProviders(<NavDesktop items={badgeItems(3)} />);

    const wrapper = screen.getByText('3').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    // The LABEL must be outside that wrapper. Without this the assertion above
    // passes against the old layout too, where the badge and the icon were
    // merely both children of the whole nav item — which is not something a
    // corner badge can be positioned against.
    expect(wrapper?.textContent).not.toContain('Add');
  });

  it('puts the dot in a wrapper holding the icon and nothing else', () => {
    renderWithProviders(<NavDesktop items={badgeItems('dot')} />);

    const wrapper = screen.getByTestId('nav-badge-dot').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });
});
