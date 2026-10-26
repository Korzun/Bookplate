import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { useToast } from './hook/use-toast';
import { ToastProvider } from './provider';

const Trigger = () => {
  const showToast = useToast();
  return (
    <button type="button" onClick={() => showToast('Saved', 'success')}>
      fire
    </button>
  );
};

let showPopover: ReturnType<typeof vi.fn>;
let hidePopover: ReturnType<typeof vi.fn>;

beforeEach(() => {
  showPopover = vi.fn();
  hidePopover = vi.fn();
  // jsdom has no Popover API; the provider must cope with its absence too,
  // which the last test covers by deleting these again.
  HTMLElement.prototype.showPopover = showPopover as unknown as () => void;
  HTMLElement.prototype.hidePopover = hidePopover as unknown as () => void;
});

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
  delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
});

describe('ToastProvider', () => {
  it('renders its toasts in a manual popover, so they sit in the top layer above an open <dialog>', () => {
    const { container } = renderWithProviders(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    const popover = container.querySelector('[popover]');
    expect(popover).not.toBeNull();
    expect(popover).toHaveAttribute('popover', 'manual');
  });

  it('shows the popover when the first toast appears and hides it when the last one is gone', () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      );
      expect(showPopover).not.toHaveBeenCalled();

      act(() => screen.getByText('fire').click());
      // `hidden: true`: jsdom's user-agent sheet hides a popover that is not
      // open, and our mocked showPopover never opens it. The last test covers
      // the un-mocked case, where no popover attribute is set at all.
      expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('Saved');
      // Shown AFTER a toast exists: a popover opened later than a modal stacks
      // above it, which is the whole point.
      expect(showPopover).toHaveBeenCalledOnce();

      // Let the toast time out, then finish its exit animation (jsdom never
      // fires animationend on its own).
      act(() => vi.runAllTimers());
      // jsdom has no AnimationEvent, and without it React subscribes to the
      // vendor-prefixed `webkitAnimationEnd` rather than `animationend` — so
      // `fireEvent.animationEnd` never reaches `onAnimationEnd` here.
      fireEvent(
        screen.getByRole('status', { hidden: true }),
        new Event('webkitAnimationEnd', { bubbles: true })
      );
      expect(screen.queryByRole('status', { hidden: true })).toBeNull();
      expect(hidePopover).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets no popover attribute, and still shows toasts, where the browser has no Popover API', () => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
    delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
    const { container } = renderWithProviders(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    expect(container.querySelector('[popover]')).toBeNull();
    act(() => screen.getByText('fire').click());
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
