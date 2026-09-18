import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookIcon, SettingsIcon, UploadIcon } from '~/icon';
import { renderWithProviders } from '~/test-utils';

import type { NavItem } from '../nav/types';
import { NavMobile } from './index';

const items = (activeLabel: string | null): NavItem[] =>
  [
    { to: '/library', label: 'Library', Icon: BookIcon },
    { to: '/add', label: 'Add', Icon: UploadIcon },
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
    expect(linkFor('Add')).toHaveAttribute('href', '/add');
    expect(linkFor('Settings')).toHaveAttribute('href', '/user');
  });

  it('marks only the active item with aria-current', () => {
    renderWithProviders(<NavMobile items={items('Add')} />);
    expect(linkFor('Add')).toHaveAttribute('aria-current', 'page');
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

const badgeItems = (badge: NavItem['badge']): NavItem[] => [
  { to: '/add', label: 'Add', Icon: UploadIcon, active: false, badge },
];

/**
 * Same contract as `nav-desktop`: an app-style badge sits on the ICON's corner,
 * which needs a wrapper holding the icon and the badge alone. Mobile previously
 * anchored it to the whole nav ITEM at a fixed `top`/`right`, which drifts from
 * the icon as the item's own geometry changes.
 */
describe('NavMobile badge placement', () => {
  it('renders the count as a readable number, not a dot-sized box', () => {
    renderWithProviders(<NavMobile items={badgeItems(4)} />);

    // Mobile used to render the count through the DOT's style — an 8x8 box with
    // no padding — so a number was squeezed into it. The count now gets the
    // same pill the desktop nav uses.
    const badge = screen.getByText('4');
    expect(badge).toBeInTheDocument();
    expect(badge).not.toHaveAttribute('data-testid', 'nav-badge-dot');
  });

  it('puts the count in a wrapper holding the icon and nothing else', () => {
    renderWithProviders(<NavMobile items={badgeItems(4)} />);

    const wrapper = screen.getByText('4').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });

  it('puts the dot in a wrapper holding the icon and nothing else', () => {
    renderWithProviders(<NavMobile items={badgeItems('dot')} />);

    const wrapper = screen.getByTestId('nav-badge-dot').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });
});
