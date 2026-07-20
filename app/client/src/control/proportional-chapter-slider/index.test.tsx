// client/src/control/proportional-chapter-slider/index.test.tsx
import { fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ProportionalChapterSlider } from './index';

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  // jsdom does not implement PointerEvent; polyfill it so fireEvent propagates clientX
  if (!window.PointerEvent) {
    class PointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    Object.defineProperty(window, 'PointerEvent', { value: PointerEvent, writable: true });
  }
});

function renderSlider(props: {
  value: number;
  chapterCount: number;
  chapterSpineMap?: number[];
  onChange?: (v: number) => void;
  onDragChange?: (d: boolean) => void;
  disabled?: boolean;
}) {
  const onChange = props.onChange ?? vi.fn();
  const { container } = renderWithProviders(
    <ProportionalChapterSlider
      value={props.value}
      onChange={onChange}
      chapterCount={props.chapterCount}
      chapterSpineMap={props.chapterSpineMap ?? []}
      disabled={props.disabled}
      onDragChange={props.onDragChange}
    />
  );
  // slider root: first child div of outermost wrapper
  const sliderRoot = container.firstElementChild!.firstElementChild as HTMLElement;
  // track: first child of sliderRoot (has trackRef)
  const track = sliderRoot.firstElementChild as HTMLElement;
  Object.defineProperty(track, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, width: 100 }) as DOMRect,
  });
  return { container, sliderRoot, track, onChange };
}

describe('ProportionalChapterSlider', () => {
  it('renders "Not started" and "Completed" labels', () => {
    const { container } = renderWithProviders(
      <ProportionalChapterSlider
        value={0}
        onChange={vi.fn()}
        chapterCount={3}
        chapterSpineMap={[]}
      />
    );
    expect(container.textContent).toContain('Not started');
    expect(container.textContent).toContain('Completed');
  });

  it('renders tick marks for chapters 1 to chapterCount', () => {
    // 3 chapters → 3 ticks (chapters 1, 2, and 3); Completed is now the right endpoint
    const { container } = renderWithProviders(
      <ProportionalChapterSlider
        value={0}
        onChange={vi.fn()}
        chapterCount={3}
        chapterSpineMap={[]}
      />
    );
    const sliderRoot = container.firstElementChild!.firstElementChild as HTMLElement;
    // Ticks have style.left but not style.width, and class doesn't contain "thumb"
    const ticksWithLeft = Array.from(sliderRoot.children).filter((el) => {
      const h = el as HTMLElement;
      return h.style.left && !h.style.width && !h.className.toLowerCase().includes('thumb');
    });
    expect(ticksWithLeft).toHaveLength(3);
  });

  it('calls onChange with the nearest chapter on pointer-up', () => {
    const onChange = vi.fn();
    const { sliderRoot } = renderSlider({ value: 0, chapterCount: 3, onChange });
    // 3 chapters, no spine map: ch1=25%, ch2=50%, ch3=75%, Completed=100% (scale=3/4)
    // clientX=60 → pct=60 → nearest to 60 is ch2 (dist=10) vs ch3 (dist=15)
    fireEvent.pointerDown(sliderRoot, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(sliderRoot, { clientX: 60, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('does not fire onDragChange when disabled', () => {
    const onDragChange = vi.fn();
    const { sliderRoot } = renderSlider({
      value: 0,
      chapterCount: 3,
      onDragChange,
      disabled: true,
    });
    fireEvent.pointerDown(sliderRoot, { clientX: 50, pointerId: 1 });
    expect(onDragChange).not.toHaveBeenCalled();
  });
});
