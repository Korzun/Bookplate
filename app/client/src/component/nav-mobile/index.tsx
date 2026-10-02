import cx from 'classnames';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useTheme } from '~/provider/theme';

import type { NavItem } from '../nav/types';
import { useStyle } from './style';

/**
 * One side of the bar, in both of the shapes it can take.
 *
 * Both shapes are always rendered, which is what makes the swap a MORPH rather
 * than a cross-fade: the pill around them is a single element whose width
 * animates between the two, so the capsule is seen to shrink into the circle
 * instead of one bar fading out while a different one fades in.
 */
export interface NavPill {
  /** Destinations shown while this side is expanded. */
  items: NavItem[];
  /** The single destination it collapses to. */
  collapsed: NavItem;
}

export interface NavMobileProps {
  /** The left-hand side: the app's main destinations. */
  main: NavPill;
  /** The right-hand side: settings. */
  settings: NavPill;
  /** Which side is expanded; the other is a circle. */
  expanded: 'main' | 'settings';
}

/** Horizontal geometry measured from the live DOM. */
interface LensBox {
  /** Active tab's left offset within the capsule. */
  left: number;
  /** Active tab's width (the lens/mask width). */
  width: number;
  /** Full capsule width — pins the blue reveal grid so its columns match the real row. */
  capsuleWidth: number;
  /**
   * The PILL's height, not the capsule's, and the diameter it collapses to.
   *
   * Measured from the pill because the row stretches both pills to a common
   * height: a side whose own content is shorter — a reader's settings side has
   * no expanded destinations at all — would otherwise collapse to a circle
   * smaller than the bar beside it.
   */
  pillHeight: number;
}

const sameBox = (a: LensBox | null, b: LensBox | null): boolean =>
  a != null &&
  b != null &&
  a.left === b.left &&
  a.width === b.width &&
  a.capsuleWidth === b.capsuleWidth &&
  a.pillHeight === b.pillHeight;

// Narrow navigation pinned to the bottom of the viewport (mobile only): two frosted
// "liquid glass" pills, one expanded and one collapsed to a circle. The expanded one's
// active tab is wrapped by a glass lens that slides between (equal-width) tabs. A blue
// copy of the tab row, clipped to the lens, reveals the active color only where the lens
// is. Hidden at and above the desktop breakpoint.
export const NavMobile = ({ main, settings, expanded }: NavMobileProps) => {
  const styles = useStyle();

  return (
    <nav className={styles.root}>
      <Pill pill={main} expanded={expanded === 'main'} styles={styles} />
      <Pill pill={settings} expanded={expanded === 'settings'} styles={styles} />
    </nav>
  );
};

const Pill = ({
  pill,
  expanded,
  styles,
}: {
  pill: NavPill;
  expanded: boolean;
  styles: ReturnType<typeof useStyle>;
}) => {
  const theme = useTheme();
  const pillRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<LensBox | null>(null);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);

  const { items, collapsed } = pill;
  const activeTo = items.find((item) => item.active)?.to;
  const CollapsedIcon = collapsed.Icon;

  // Measure the active tab's horizontal box (its vertical extent is fixed in CSS) so
  // the lens can wrap and morph to it, plus the two sizes this pill animates between.
  // Runs after paint so the morph transition starts from the on-screen position. Keeps
  // the last lens box when the route maps to no tab, so the lens fades out / back in
  // place. Re-measures on active-tab/tab-set change, on expand/collapse, and on resize.
  useEffect(() => {
    const container = containerRef.current;
    const pillElement = pillRef.current;
    if (!container || !pillElement) return;

    const measure = () => {
      const pillBox = pillElement.getBoundingClientRect();
      const containerBox = container.getBoundingClientRect();
      const active = container.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) {
        // Still record the SIZES. A collapsed pill has no active tab inside it,
        // and an early return here would leave it with no width to animate to.
        setBox((prev) =>
          prev === null
            ? { left: 0, width: 0, capsuleWidth: containerBox.width, pillHeight: pillBox.height }
            : { ...prev, capsuleWidth: containerBox.width, pillHeight: pillBox.height }
        );
        setShown(false);
        return;
      }
      const activeBox = active.getBoundingClientRect();
      const next: LensBox = {
        left: activeBox.left - containerBox.left - container.clientLeft,
        width: activeBox.width,
        capsuleWidth: containerBox.width,
        pillHeight: pillBox.height,
      };
      setBox((prev) => (sameBox(prev, next) ? prev : next));
      setShown(true);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(pillElement);
    return () => observer.disconnect();
  }, [activeTo, items.length, expanded]);

  // Enable the morph transitions one frame after the first placement, so they are never
  // turned on in the same frame a position or width is first set. Without this a pill
  // would animate its whole width on mount — from the natural capsule width down to a
  // circle — as if the bar were collapsing on arrival.
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(() => setReady(true));
    } else {
      timer = setTimeout(() => setReady(true), 0);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // The lens slides via transform. The blue reveal is a fixed full-row overlay that
  // never moves — instead a clip-path window (matching the lens box) animates over it,
  // so the blue can't drift relative to the tabs; it's simply unmasked as the lens passes.
  const lensStyle: CSSProperties = box
    ? { opacity: shown ? 1 : 0, width: box.width, transform: `translateX(${box.left}px)` }
    : { opacity: 0 };
  const clip = box
    ? `inset(${theme.space.xs} ${box.capsuleWidth - box.left - box.width}px ${theme.space.xs} ${box.left}px round ${theme.radius.pill})`
    : undefined;
  const revealStyle: CSSProperties = box
    ? { opacity: shown ? 1 : 0, clipPath: clip, WebkitClipPath: clip }
    : { opacity: 0 };

  // The morph itself: one number, animated. Expanded, the pill is as wide as its capsule
  // naturally is; collapsed, as wide as it is tall, which at `radius.pill` is a circle.
  // Left to CSS until the first measurement, so a pill never renders at a guessed width.
  const pillStyle: CSSProperties | undefined =
    box === null ? undefined : { width: expanded ? box.capsuleWidth : box.pillHeight };

  return (
    <div
      ref={pillRef}
      className={cx(styles.pill, { [styles.pillReady]: ready, [styles.pillCollapsed]: !expanded })}
      style={pillStyle}
    >
      <div className={styles.glass} aria-hidden="true" />
      <div
        ref={containerRef}
        className={cx(styles.capsule, { [styles.capsuleHidden]: !expanded })}
        // A collapsed pill's destinations are behind a clip, not merely faded:
        // without these they stay in the accessibility tree and the tab order, and a
        // screen reader reads a navigation nobody can see.
        aria-hidden={expanded ? undefined : true}
        inert={expanded ? undefined : true}
      >
        <span
          className={cx(styles.lens, { [styles.lensReady]: ready })}
          style={lensStyle}
          aria-hidden="true"
        />
        {items.map(({ to, label, Icon, active, badge }) => (
          <Link key={to} className={styles.item} aria-current={active ? 'page' : undefined} to={to}>
            {/* Same wrapper as `nav-desktop`: the badge belongs on the icon's
                corner. This used to be anchored to the item at a fixed
                `top`/`right`, which tracks the item's geometry rather than the
                icon's. */}
            <span className={styles.iconWrap}>
              <Icon height={14} width={14} />
              {typeof badge === 'number' && badge > 0 && (
                <span className={styles.badge}>{badge}</span>
              )}
              {badge === 'dot' && <span className={styles.badgeDot} data-testid="nav-badge-dot" />}
            </span>
            {label}
          </Link>
        ))}
        <div className={styles.grayLayer} aria-hidden="true">
          {items.map(({ to, label, Icon }) => (
            <span key={to} className={styles.layerItem}>
              <Icon height={14} width={14} />
              {label}
            </span>
          ))}
        </div>
        <div
          className={cx(styles.reveal, { [styles.revealReady]: ready })}
          style={revealStyle}
          aria-hidden="true"
        >
          {items.map(({ to, label, Icon }) => (
            <span key={to} className={styles.layerItem}>
              <Icon height={14} width={14} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <Link
        className={cx(styles.collapsedLink, {
          [styles.collapsedHidden]: expanded,
          [styles.collapsedActive]: collapsed.active,
        })}
        // The mirror of the capsule's pair above: whichever shape is not showing
        // is out of the accessibility tree and the tab order, so the bar offers
        // exactly what is on screen and nothing else.
        aria-hidden={expanded ? true : undefined}
        inert={expanded ? true : undefined}
        aria-current={collapsed.active ? 'page' : undefined}
        aria-label={collapsed.label}
        to={collapsed.to}
      >
        <CollapsedIcon height={18} width={18} />
      </Link>
    </div>
  );
};
