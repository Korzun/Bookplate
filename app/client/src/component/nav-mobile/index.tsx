import cx from 'classnames';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useTheme } from '~/provider/theme';

import type { NavItem } from '../nav/types';
import { useStyle } from './style';

export interface NavMobileProps {
  items: NavItem[];
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
export const NavMobile = ({ items }: NavMobileProps) => {
  const styles = useStyle();
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<LensBox | null>(null);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);

  const activeTo = items.find((item) => item.active)?.to;

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
      <div className={styles.capsule} ref={containerRef}>
        <div className={styles.glass} aria-hidden="true" />
        <span
          className={cx(styles.lens, { [styles.lensReady]: ready })}
          style={lensStyle}
          aria-hidden="true"
        />
        {items.map(({ to, label, Icon, active }) => (
          <Link key={to} className={styles.item} aria-current={active ? 'page' : undefined} to={to}>
            <Icon height={14} width={14} />
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
