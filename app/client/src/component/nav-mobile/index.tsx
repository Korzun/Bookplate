import cx from 'classnames';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useTheme } from '~/provider/theme';

import type { NavItem } from '../nav/types';
import { useStyle } from './style';

/**
 * How much taller than usual the nav currently is, published so anything that
 * docks above it can clear it.
 *
 * `theme.layout.navHeightMobile` is a FIXED 96px describing the capsule alone,
 * and both `component/page`'s bottom padding and the toast stack are measured
 * from it. A sub-bar makes the nav taller than that constant, and while the
 * page's reservation carries enough slack to absorb it, the toast stack sits
 * only `space.md` above the 96 and would land on top of the sub-bar.
 *
 * A custom property rather than a second constant because the height depends
 * on what is rendered, and a hard-coded copy would drift the moment the
 * control inside changes. Defaults to `0px` wherever it is unset — which is
 * every route without a sub-bar, i.e. nearly all of them.
 */
const NAV_EXTRA_HEIGHT_PROPERTY = '--nav-mobile-extra-height';

export interface NavMobileProps {
  items: NavItem[];
  /**
   * A second level for the active tab, stacked directly above the capsule
   * inside the same fixed container — so it rides with the nav instead of
   * scrolling with the page, and the two read as one piece of chrome.
   *
   * `Nav` decides when there is one (today: the admin Users/Devices pair,
   * only while that tab is active). Null the rest of the time, which is most
   * of the time, so the capsule sits where it always has.
   */
  subNav?: ReactNode;
}

/** Horizontal geometry measured from the live DOM. */
interface LensBox {
  /** Active tab's left offset within the capsule. */
  left: number;
  /** Active tab's width (the lens/mask width). */
  width: number;
  /** Full capsule width — pins the blue reveal grid so its columns match the real row. */
  capsuleWidth: number;
}

const sameBox = (a: LensBox | null, b: LensBox | null): boolean =>
  a != null &&
  b != null &&
  a.left === b.left &&
  a.width === b.width &&
  a.capsuleWidth === b.capsuleWidth;

// Narrow navigation pinned to the bottom of the viewport (mobile only): a frosted
// "liquid glass" capsule whose active tab is wrapped by a glass lens that slides
// between (equal-width) tabs. A blue copy of the tab row, clipped to the lens, reveals
// the active color only where the lens is. Hidden at and above the desktop breakpoint.
export const NavMobile = ({ items, subNav = null }: NavMobileProps) => {
  const styles = useStyle();
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<LensBox | null>(null);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);

  const subNavRef = useRef<HTMLDivElement>(null);

  const activeTo = items.find((item) => item.active)?.to;

  // Publish (and retract) the sub-bar's height on the document element. Not on
  // this nav or a container: the toast stack is `position: fixed` and renders
  // from its own provider, which is not guaranteed to be a descendant of
  // anything here, so the one ancestor both are certain to share is the root.
  useEffect(() => {
    const root = document.documentElement;
    const element = subNavRef.current;
    if (element === null) {
      root.style.removeProperty(NAV_EXTRA_HEIGHT_PROPERTY);
      return;
    }
    // Plus the column gap: the sub-bar's own box does not include the space
    // between it and the capsule, and anything docking above the nav has to
    // clear both.
    root.style.setProperty(
      NAV_EXTRA_HEIGHT_PROPERTY,
      `calc(${element.offsetHeight}px + ${theme.space.sm})`
    );
    return () => {
      root.style.removeProperty(NAV_EXTRA_HEIGHT_PROPERTY);
    };
  }, [subNav, theme.space.sm]);

  // Measure the active tab's horizontal box (its vertical extent is fixed in CSS)
  // so the lens can wrap and morph to it. Runs after paint so the morph transition
  // starts from the on-screen position. Keeps the last box when the route maps to no
  // tab, so the lens fades out / back in place. Re-measures on active-tab/tab-set
  // change and on container resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const active = container.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) {
        setShown(false);
        return;
      }
      const containerBox = container.getBoundingClientRect();
      const activeBox = active.getBoundingClientRect();
      const next: LensBox = {
        left: activeBox.left - containerBox.left - container.clientLeft,
        width: activeBox.width,
        capsuleWidth: containerBox.width,
      };
      setBox((prev) => (sameBox(prev, next) ? prev : next));
      setShown(true);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeTo, items.length]);

  // Enable the morph transition one frame after the first placement, so it is never
  // turned on in the same frame the lens position changes.
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

  return (
    <nav className={styles.root}>
      {/* The wrapper is a measurement anchor for the effect above, which has
          to know how much taller the sub-bar makes this nav. It deliberately
          gets none of the capsule's frosted glass — two stacked glass
          surfaces read as two bars competing for the same corner, and the
          control inside carries its own background already. */}
      {subNav !== null && <div ref={subNavRef}>{subNav}</div>}
      <div className={styles.capsule} ref={containerRef}>
        <div className={styles.glass} aria-hidden="true" />
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
    </nav>
  );
};
