import { useState, useCallback, useRef } from 'react';

import { useStyle } from './style';

type ProportionalChapterSliderProps = {
  value: number;
  onChange: (v: number) => void;
  chapterCount: number;
  chapterSpineMap: number[];
  disabled?: boolean;
  onDragChange?: (dragging: boolean) => void;
};

function chapterPct(i: number, spineMap: number[], count: number): number {
  if (i === 0) return 0;
  if (count <= 0) return 0;
  const max = spineMap.length > 0 ? spineMap[spineMap.length - 1] : 0;
  if (!max) return (i / count) * 100;
  const pos = spineMap[i - 1];
  if (pos === undefined) return (i / count) * 100;
  return (pos / max) * 100;
}

function nearestChapter(pct: number, spineMap: number[], count: number): number {
  let best = 0;
  let bestDist = pct;
  for (let i = 1; i <= count; i++) {
    const d = Math.abs(pct - chapterPct(i, spineMap, count));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

const SNAP_TRANSITION = 'left 0.15s ease';
const FILL_SNAP_TRANSITION = 'width 0.15s ease';

export function ProportionalChapterSlider({
  value,
  onChange,
  chapterCount,
  chapterSpineMap,
  disabled = false,
  onDragChange,
}: ProportionalChapterSliderProps) {
  const styles = useStyle();
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [dragPct, setDragPct] = useState<number | null>(null);

  const getPct = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      onDragChange?.(true);
      setDragPct(getPct(e.clientX));
    },
    [disabled, getPct, onDragChange]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      setDragPct(getPct(e.clientX));
    },
    [getPct]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      onDragChange?.(false);
      const snapped = nearestChapter(getPct(e.clientX), chapterSpineMap, chapterCount);
      setDragPct(null);
      onChange(snapped);
    },
    [getPct, chapterSpineMap, chapterCount, onChange, onDragChange]
  );

  const handlePointerCancel = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    onDragChange?.(false);
    setDragPct(null);
  }, [onDragChange]);

  // While dragging: raw pct drives visuals, no transition.
  // After release: value prop drives visuals, CSS transition animates the snap.
  const isDragging = dragPct !== null;
  const displayPct = isDragging ? dragPct : chapterPct(value, chapterSpineMap, chapterCount);
  const displayValue = isDragging ? nearestChapter(dragPct, chapterSpineMap, chapterCount) : value;

  const ticks = Array.from({ length: Math.max(0, chapterCount - 1) }, (_, i) => {
    const ch = i + 1;
    return {
      ch,
      pct: chapterPct(ch, chapterSpineMap, chapterCount),
      active: ch <= displayValue,
    };
  });

  return (
    <div>
      <div
        className={styles.root}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className={styles.track} ref={trackRef} />
        <div
          className={styles.fill}
          style={{
            width: `${displayPct}%`,
            transition: isDragging ? undefined : FILL_SNAP_TRANSITION,
          }}
        />
        {ticks.map(({ ch, pct, active }) => (
          <div
            key={ch}
            className={active ? `${styles.tick} ${styles.tickActive}` : styles.tick}
            style={{ left: `${pct}%` }}
          />
        ))}
        <div
          className={disabled ? `${styles.thumb} ${styles.thumbDisabled}` : styles.thumb}
          style={{ left: `${displayPct}%`, transition: isDragging ? undefined : SNAP_TRANSITION }}
        />
      </div>
      <div className={styles.labels}>
        <span>Not started</span>
        <span>Finished</span>
      </div>
    </div>
  );
}
