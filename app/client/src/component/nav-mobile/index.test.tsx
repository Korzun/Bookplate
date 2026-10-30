import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookIcon, SettingsIcon, UploadIcon } from '~/icon';
import { MINIMIZE_SPEED } from '~/lib/use-minimize-on-scroll';
import { renderWithProviders } from '~/test-utils';

import type { NavItem } from '../nav/types';
import { NavMobile } from './index';

const items = (activeLabel: string | null): NavItem[] =>
  [
    { to: '/library', label: 'Library', Icon: BookIcon },
    { to: '/upload', label: 'Upload', Icon: UploadIcon },
    { to: '/settings', label: 'Settings', Icon: SettingsIcon },
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
const GEAR: NavItem = {
  to: '/settings',
  label: 'Open settings',
  Icon: SettingsIcon,
  active: false,
};

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
    expect(linkFor('Upload')).toHaveAttribute('href', '/upload');
    expect(linkFor('Settings')).toHaveAttribute('href', '/settings');
  });

  it('marks only the active item with aria-current', () => {
    renderBar(items('Upload'));
    expect(linkFor('Upload')).toHaveAttribute('aria-current', 'page');
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
  { to: '/upload', label: 'Upload', Icon: UploadIcon, active: false, badge },
];

/**
 * Same contract as `nav-desktop`: an app-style badge sits on the ICON's corner,
 * which needs a wrapper holding the icon and the badge alone. Mobile previously
 * anchored it to the whole nav ITEM at a fixed `top`/`right`, which drifts from
 * the icon as the item's own geometry changes.
 */
describe('NavMobile badge placement', () => {
  // The link's accessible name runs the count into the label ("4Upload"), so
  // match on the label alone.
  const uploadLink = () => screen.getByRole('link', { name: /Upload/ });

  it('renders the count as a readable number, not a dot-sized box', () => {
    renderBar(badgeItems(4));

    // Mobile used to render the count through the DOT's style — an 8x8 box with
    // no padding — so a number was squeezed into it. The count now gets the
    // same pill the desktop nav uses.
    const badge = within(uploadLink()).getByText('4');
    expect(badge).toBeInTheDocument();
    expect(badge).not.toHaveAttribute('data-testid', 'nav-badge-dot');
  });

  it('puts the count in a wrapper holding the icon and nothing else', () => {
    renderBar(badgeItems(4));

    const wrapper = within(uploadLink()).getByText('4').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });

  it('puts the dot in a wrapper holding the icon and nothing else', () => {
    renderBar(badgeItems('dot'));

    const wrapper = within(uploadLink()).getByTestId('nav-badge-dot').parentElement;
    expect(wrapper?.querySelector('svg')).toBeTruthy();
    expect(wrapper?.textContent).not.toContain('Add');
  });

  /**
   * The real tab is transparent; what the eye sees is the gray row and the
   * blue reveal row stacked ABOVE it. A badge rendered only inside the real
   * tab therefore sat underneath the overlay's copy of the icon, which painted
   * its strokes across the badge. Each visible row has to carry the badge too,
   * so it paints over its own icon the way the desktop nav's does.
   */
  it('repeats the count in both visible overlay rows, on the icon', () => {
    renderBar(badgeItems(4));

    const overlayCopies = screen
      .getAllByText('4')
      .filter((copy) => copy.closest('[aria-hidden="true"]') !== null);
    expect(overlayCopies).toHaveLength(2);
    for (const copy of overlayCopies) {
      expect(copy.parentElement?.querySelector('svg')).toBeTruthy();
      expect(copy.parentElement?.textContent).not.toContain('Upload');
    }
  });

  it('repeats the dot in both visible overlay rows, on the icon', () => {
    renderBar(badgeItems('dot'));

    const overlayCopies = screen
      .getAllByTestId('nav-badge-dot')
      .filter((copy) => copy.closest('[aria-hidden="true"]') !== null);
    expect(overlayCopies).toHaveLength(2);
    for (const copy of overlayCopies) {
      expect(copy.parentElement?.querySelector('svg')).toBeTruthy();
    }
  });
});

/**
 * Minimize-on-scroll. The expanded side shrinks to a circle holding the active
 * tab when the page is flicked down and comes back on the way up — the same
 * morph as the route-driven collapse, with a different shape in the circle.
 * The thresholds themselves are `use-minimize-on-scroll`'s to test; here it is
 * what the bar OFFERS in each state.
 */
describe('NavMobile minimized by scrolling', () => {
  const scrollTo = (y: number) =>
    Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });

  // The hook measures speed against `performance.now()`, driven by hand here.
  let now = 0;
  const FRAME = 16;
  const scrolledTo = (y: number) => {
    now += FRAME;
    scrollTo(y);
    fireEvent.scroll(window);
  };

  // A user-driven flick: a finger touched the page and the next frame moved
  // it down faster than the threshold.
  const flickDown = () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 5000,
      configurable: true,
    });
    act(() => {
      fireEvent.touchStart(document.body, { touches: [{ clientX: 0, clientY: 0 }] });
      scrolledTo(100);
      scrolledTo(100 + Math.ceil(MINIMIZE_SPEED * FRAME) + 1);
    });
  };

  const showNavigation = () => screen.getByRole('button', { name: 'Show navigation' });

  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    scrollTo(0);
    vi.restoreAllMocks();
  });

  it('offers the destinations, not the minimized button, before any scroll', () => {
    renderBar(items('Library'));
    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show navigation' })).not.toBeInTheDocument();
  });

  it('swaps the destinations for one button once the page scrolls down', () => {
    renderBar(items('Upload'));
    flickDown();

    expect(screen.queryByRole('link', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Upload/ })).not.toBeInTheDocument();
    expect(showNavigation()).toHaveAttribute('aria-expanded', 'false');
    // The route-collapsed shape stays out of it: this side is minimized, not
    // collapsed, and its circle is the active tab, not "Back to library".
    expect(screen.queryByRole('link', { name: 'Back to library' })).not.toBeInTheDocument();
  });

  it('leaves the other side circle alone', () => {
    renderBar(items('Library'));
    flickDown();
    expect(screen.getByRole('link', { name: 'Open settings' })).toBeInTheDocument();
  });

  it('brings the destinations back when the button is pressed', () => {
    renderBar(items('Library'));
    flickDown();
    expect(showNavigation()).toBeInTheDocument();

    fireEvent.click(showNavigation());

    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show navigation' })).not.toBeInTheDocument();
  });

  it('brings the destinations back when the page scrolls up', () => {
    renderBar(items('Library'));
    flickDown();
    expect(showNavigation()).toBeInTheDocument();

    act(() => scrolledTo(1));

    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
  });

  it('carries the active tab badge into the minimized circle', () => {
    renderBar([
      { to: '/library', label: 'Library', Icon: BookIcon, active: false, badge: 'dot' },
      { to: '/upload', label: 'Upload', Icon: UploadIcon, active: true, badge: 4 },
    ]);
    flickDown();
    expect(within(showNavigation()).getByText('4')).toBeInTheDocument();
  });

  it('summarises hidden siblings as a dot when the active tab has no badge', () => {
    renderBar([
      { to: '/library', label: 'Library', Icon: BookIcon, active: true },
      { to: '/upload', label: 'Upload', Icon: UploadIcon, active: false, badge: 4 },
    ]);
    flickDown();
    const button = showNavigation();
    expect(within(button).getByTestId('nav-badge-dot')).toBeInTheDocument();
    expect(within(button).queryByText('4')).not.toBeInTheDocument();
  });

  /**
   * The circle is the selected tab carried over, so it wears the lens's
   * surface — not the bare pill with a blue glyph in it.
   */
  it('paints the minimized circle with the selected tab surface', () => {
    const { container } = renderBar(items('Library'));
    flickDown();
    const lens = container.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(lens).not.toBeNull();
    const lensSurface = getComputedStyle(lens as HTMLElement);
    const buttonSurface = getComputedStyle(showNavigation());
    expect(buttonSurface.backgroundColor).toBe(lensSurface.backgroundColor);
    expect(buttonSurface.backgroundColor).not.toBe('');
    expect(buttonSurface.borderColor).toBe(lensSurface.borderColor);
  });

  /**
   * A reader on Settings: the main group is still the expanded side but none
   * of its tabs is selected (the gear circle is). Minimized, it shows its
   * stand-in glyph — and that glyph is NOT lit, because nothing here is.
   */
  it('leaves the circle unlit when no tab in the group is selected', () => {
    const { container } = renderBar(items(null));
    flickDown();
    const lens = container.querySelector<HTMLElement>('span[aria-hidden="true"]');
    const lensSurface = getComputedStyle(lens as HTMLElement);
    const button = showNavigation();
    const buttonSurface = getComputedStyle(button);
    expect(buttonSurface.backgroundColor).not.toBe(lensSurface.backgroundColor);
    // Same colour as the other side's unselected circle, not the brand blue.
    const gear = screen.getByRole('link', { name: 'Open settings' });
    expect(buttonSurface.color).toBe(getComputedStyle(gear).color);
    expect(buttonSurface.color).not.toBe('');
  });

  it('shows no badge on the button while the side is not minimized', () => {
    renderBar(badgeItems(4));
    // The hidden button is still mounted (it is what the pill morphs to), so
    // a badge left on it would double-count the tab's own.
    const buttons = document.querySelectorAll('button[aria-label="Show navigation"]');
    for (const button of Array.from(buttons)) {
      expect(button.textContent).not.toContain('4');
    }
  });
});
