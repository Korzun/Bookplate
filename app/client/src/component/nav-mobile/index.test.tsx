import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookIcon, SettingsIcon, UploadIcon } from '~/icon';
import { renderWithProviders } from '~/test-utils';

import type { NavItem } from '../nav/types';
import { NavMobile } from './index';

const items = (activeLabel: string | null): NavItem[] =>
  [
    { to: '/library', label: 'Library', Icon: BookIcon },
    { to: '/upload', label: 'Upload', Icon: UploadIcon },
    { to: '/user', label: 'Settings', Icon: SettingsIcon },
  ].map((item) => ({ ...item, active: item.label === activeLabel }));

// Each label also appears in the (aria-hidden) blue reveal copy, so query the link
// by its accessible role/name rather than by text.
const linkFor = (label: string) => screen.getByRole('link', { name: label });

// Collect every rule of every injected stylesheet (react-jss inserts via CSSOM).
const collectCss = (): string => {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += `${rule.cssText}\n`;
    } catch {
      // unreadable sheet — skip
    }
  }
  document.querySelectorAll('style').forEach((s) => {
    css += `${s.textContent ?? ''}\n`;
  });
  return css;
};

describe('NavMobile', () => {
  it('renders a link for every item', () => {
    renderWithProviders(<NavMobile items={items('Library')} />);
    expect(linkFor('Library')).toHaveAttribute('href', '/library');
    expect(linkFor('Upload')).toHaveAttribute('href', '/upload');
    expect(linkFor('Settings')).toHaveAttribute('href', '/user');
  });

  it('marks only the active item with aria-current', () => {
    renderWithProviders(<NavMobile items={items('Upload')} />);
    expect(linkFor('Upload')).toHaveAttribute('aria-current', 'page');
    expect(linkFor('Library')).not.toHaveAttribute('aria-current');
    expect(linkFor('Settings')).not.toHaveAttribute('aria-current');
  });

  it('renders the decorative lens element', () => {
    const { container } = renderWithProviders(<NavMobile items={items('Library')} />);
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('marks no item active when none matches the route', () => {
    renderWithProviders(<NavMobile items={items(null)} />);
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('emits an opaque capsule fallback where backdrop-filter is unsupported', () => {
    renderWithProviders(<NavMobile items={items('Library')} />);
    const css = collectCss();
    expect(css).toMatch(/@supports not.*backdrop-filter/);
    expect(css).toContain('rgba(255, 255, 255, 0.92)');
  });

  it('drops the slide under reduced motion (lens/reveal snap)', () => {
    renderWithProviders(<NavMobile items={items('Library')} />);
    expect(collectCss()).toContain('prefers-reduced-motion: reduce');
  });
});
