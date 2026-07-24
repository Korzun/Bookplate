import { fireEvent, render } from '@testing-library/react';
import { useNavigate } from 'react-router';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScrollRestoration } from './scroll-restoration';

// A page that pushes the given `to` (optionally carrying navigation state) when
// its button is clicked, plus a "back" button that performs a history POP.
function Page({ to, state, label }: { to: string; state?: unknown; label: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <span>{label}</span>
      <button onClick={() => navigate(to, state ? { state } : undefined)}>go</button>
      <button onClick={() => navigate(-1)}>back</button>
    </div>
  );
}

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => value });
}

describe('ScrollRestoration', () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    setScrollY(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrolls to the top when navigating forward to a new page (PUSH)', () => {
    setScrollY(500); // pretend the starting page is scrolled down

    const { getByText } = render(
      <MemoryRouter initialEntries={['/list-a']}>
        <ScrollRestoration />
        <Routes>
          <Route path="/list-a" element={<Page label="list" to="/detail-a" />} />
          <Route path="/detail-a" element={<Page label="detail" to="/" />} />
        </Routes>
      </MemoryRouter>
    );

    scrollTo.mockClear();
    fireEvent.click(getByText('go')); // PUSH /list-a -> /detail-a

    expect(getByText('detail')).toBeInTheDocument();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('restores the saved position when a navigation opts in via restoreScroll state', () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={['/list-b']}>
        <ScrollRestoration />
        <Routes>
          <Route path="/list-b" element={<Page label="list" to="/detail-b" />} />
          <Route
            path="/detail-b"
            element={<Page label="detail" to="/list-b" state={{ restoreScroll: true }} />}
          />
        </Routes>
      </MemoryRouter>
    );

    // Scroll the list down, then leave it. The last scrolled position must be remembered.
    setScrollY(640);
    fireEvent.scroll(window);

    fireEvent.click(getByText('go')); // PUSH /list-b -> /detail-b (scrolls to top)
    expect(getByText('detail')).toBeInTheDocument();

    setScrollY(0);
    scrollTo.mockClear();
    fireEvent.click(getByText('go')); // "up" navigation back to /list-b with restore flag

    expect(getByText('list')).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
  });

  it('re-applies the restore once the destination page grows to full height', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    let scrollHeight = 800; // starts as tall as the viewport: cannot reach 640 yet
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 800 });

    try {
      const { getByText } = render(
        <MemoryRouter initialEntries={['/list-d']}>
          <ScrollRestoration />
          <Routes>
            <Route path="/list-d" element={<Page label="list" to="/detail-d" />} />
            <Route
              path="/detail-d"
              element={<Page label="detail" to="/list-d" state={{ restoreScroll: true }} />}
            />
          </Routes>
        </MemoryRouter>
      );

      setScrollY(640);
      fireEvent.scroll(window);

      fireEvent.click(getByText('go')); // -> detail (top)
      fireEvent.click(getByText('go')); // -> list-d with restore flag; page still short

      vi.advanceTimersToNextFrame(); // frame while the page is too short: no landing yet
      scrollTo.mockClear();

      scrollHeight = 2000; // content finished loading — page is now tall enough
      vi.advanceTimersToNextFrame();

      expect(scrollTo).toHaveBeenCalledWith(0, 640);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the saved position on a history POP (browser back)', () => {
    const { getByText } = render(
      <MemoryRouter initialEntries={['/list-c']}>
        <ScrollRestoration />
        <Routes>
          <Route path="/list-c" element={<Page label="list" to="/detail-c" />} />
          <Route path="/detail-c" element={<Page label="detail" to="/" />} />
        </Routes>
      </MemoryRouter>
    );

    setScrollY(720);
    fireEvent.scroll(window);

    fireEvent.click(getByText('go')); // PUSH /list-c -> /detail-c
    expect(getByText('detail')).toBeInTheDocument();

    setScrollY(0);
    scrollTo.mockClear();
    fireEvent.click(getByText('back')); // POP back to /list-c

    expect(getByText('list')).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 720);
  });
});
