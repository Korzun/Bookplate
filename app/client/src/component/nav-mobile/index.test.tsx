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

/**
 * The bar always has two sides, so every render needs both. These stand in for
 * the real ones: `main` is the side under test, `settings` is a side with
 * nothing to expand into — exactly the shape a reader's settings side has.
 */
const HOME: NavItem = { to: '/library', label: 'Back to library', Icon: BookIcon, active: false };
// Deliberately NOT 'Settings': `items` already has a tab by that name, and two
// links sharing an accessible name make every role query here ambiguous.
const GEAR: NavItem = { to: '/user', label: 'Open settings', Icon: SettingsIcon, active: false };

const renderBar = (mainItems: NavItem[], { expanded = 'main' as 'main' | 'settings' } = {}) =>
  renderWithProviders(
    <NavMobile
      main={{ items: mainItems, collapsed: HOME }}
      settings={{ items: [], collapsed: GEAR }}
      expanded={expanded}
    />
  );

describe('NavMobile', () => {
  it('renders a link for every item', () => {
    renderBar(items('Library'));
    expect(linkFor('Library')).toHaveAttribute('href', '/library');
    expect(linkFor('Add')).toHaveAttribute('href', '/add');
    expect(linkFor('Settings')).toHaveAttribute('href', '/user');
  });

  it('marks only the active item with aria-current', () => {
    renderBar(items('Add'));
    expect(linkFor('Add')).toHaveAttribute('aria-current', 'page');
    expect(linkFor('Library')).not.toHaveAttribute('aria-current');
    expect(linkFor('Settings')).not.toHaveAttribute('aria-current');
  });

  it('renders the decorative lens element', () => {
    const { container } = renderBar(items('Library'));
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('marks no item active when none matches the route', () => {
    renderBar(items(null));
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('emits an opaque capsule fallback where backdrop-filter is unsupported', () => {
    renderBar(items('Library'));
    const css = collectCss();
    expect(css).toMatch(/@supports not.*backdrop-filter/);
    expect(css).toContain('rgba(255, 255, 255, 0.92)');
  });

  /**
   * A collapsed side still holds its full capsule — that is what the pill
   * morphs back out to — so the destinations are in the document behind a
   * clip. Everything that keeps them from being reachable lives on the
   * capsule: out of the accessibility tree, out of the tab order.
   */
  it('hides a collapsed side destinations from assistive tech and the tab order', () => {
    renderBar(items('Library'), { expanded: 'settings' });
    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add' })).not.toBeInTheDocument();
    // That side offers its collapsed link in their place.
    expect(screen.getByRole('link', { name: 'Back to library' })).toBeInTheDocument();
  });

  it('offers the expanded side destinations and not its collapsed link', () => {
    renderBar(items('Library'));
    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    // `Back to library` is this side's COLLAPSED shape, which is not showing.
    expect(screen.queryByRole('link', { name: 'Back to library' })).not.toBeInTheDocument();
  });

  /**
   * The morph. One element changes width between the capsule's natural width
   * and its own height (a circle at `radius.pill`), so the capsule is seen to
   * shrink into the circle rather than being swapped for it.
   *
   * The stylesheet is the thing to assert: the widths come from measurements
   * jsdom reports as 0, and a screenshot cannot catch a 350ms animation.
   */
  it('animates the pill width rather than swapping the two shapes', () => {
    renderBar(items('Library'));
    const css = collectCss();
    expect(css).toMatch(/transition:\s*width/);
    // Clipping is what makes the too-wide shape disappear into the circle.
    expect(css).toMatch(/overflow:\s*hidden/);
  });

  it('drops the slide under reduced motion (lens/reveal snap)', () => {
    renderBar(items('Library'));
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
    renderBar(badgeItems(4));

    // Mobile used to render the count through the DOT's style — an 8x8 box with
    // no padding — so a number was squeezed into it. The count now gets the
    // same pill the desktop nav uses.
    const badge = screen.getByText('4');
    expect(badge).toBeInTheDocument();
    expect(badge).not.toHaveAttribute('data-testid', 'nav-badge-dot');
  });

  it('puts the count in a wrapper holding the icon and nothing else', () => {
    renderBar(badgeItems(4));

    const wrapper = screen.getByText('4').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });

  it('puts the dot in a wrapper holding the icon and nothing else', () => {
    renderBar(badgeItems('dot'));

    const wrapper = screen.getByTestId('nav-badge-dot').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });
});
