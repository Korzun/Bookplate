import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

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
