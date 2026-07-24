import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookIcon, SettingsIcon, UploadIcon } from '~/icon';
import { renderWithProviders } from '~/test-utils';

import type { NavItem } from '../nav/types';
import { NavDesktop } from './index';

const items: NavItem[] = [
  { to: '/library', label: 'Library', Icon: BookIcon, active: true },
  { to: '/upload', label: 'Upload', Icon: UploadIcon, active: false },
  { to: '/user', label: 'Settings', Icon: SettingsIcon, active: false },
];

const linkFor = (label: string) => screen.getByText(label).closest('a');

describe('NavDesktop', () => {
  it('renders a link for every item', () => {
    renderWithProviders(<NavDesktop items={items} />);
    expect(linkFor('Library')).toHaveAttribute('href', '/library');
    expect(linkFor('Upload')).toHaveAttribute('href', '/upload');
    expect(linkFor('Settings')).toHaveAttribute('href', '/user');
  });

  it('marks only the active item with aria-current', () => {
    renderWithProviders(<NavDesktop items={items} />);
    expect(linkFor('Library')).toHaveAttribute('aria-current', 'page');
    expect(linkFor('Upload')).not.toHaveAttribute('aria-current');
    expect(linkFor('Settings')).not.toHaveAttribute('aria-current');
  });

  it('renders no background noise overlay', () => {
    const { container } = renderWithProviders(<NavDesktop items={items} />);
    expect(container.querySelector('#nav-desktop-noise')).toBeNull();
  });
});

function badgeItems(badge: NavItem['badge']): NavItem[] {
  return [{ to: '/upload', label: 'Upload', Icon: UploadIcon, active: false, badge }];
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
