import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { RatingPicker } from './index';

const NAMES = ['Bad', 'Okay', 'Nice', 'Great', 'Love'];

describe('RatingPicker', () => {
  it('renders a radiogroup with five radios named Bad, Okay, Nice, Great, Love', () => {
    renderWithProviders(<RatingPicker label="Overall" value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Overall' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(NAMES);
    for (const name of NAMES) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('marks the value as checked and nothing when null', () => {
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={3} onChange={vi.fn()} />
    );
    expect(screen.getByRole('radio', { name: 'Nice' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Nice' })).toHaveAttribute('tabindex', '0');
    for (const name of ['Bad', 'Okay', 'Great', 'Love']) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('radio', { name })).toHaveAttribute('tabindex', '-1');
    }

    rerender(<RatingPicker label="Overall" value={null} onChange={vi.fn()} />);
    for (const name of NAMES) {
      expect(screen.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'false');
    }
    // Nothing checked: the first radio is the tab stop.
    expect(screen.getByRole('radio', { name: 'Bad' })).toHaveAttribute('tabindex', '0');
  });

  it('click selects; clicking the checked radio clears', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={null} onChange={onChange} />
    );
    await user.click(screen.getByRole('radio', { name: 'Great' }));
    expect(onChange).toHaveBeenLastCalledWith(4);

    rerender(<RatingPicker label="Overall" value={4} onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Great' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ArrowRight from Great selects Love and from Love does nothing (no wrap)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={4} onChange={onChange} />
    );
    screen.getByRole('radio', { name: 'Great' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(5);

    onChange.mockClear();
    rerender(<RatingPicker label="Overall" value={5} onChange={onChange} />);
    screen.getByRole('radio', { name: 'Love' }).focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowUp}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowLeft from Bad does nothing; Home selects Bad; End selects Love', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={1} onChange={onChange} />
    );
    screen.getByRole('radio', { name: 'Bad' }).focus();
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowDown}');
    expect(onChange).not.toHaveBeenCalled();

    rerender(<RatingPicker label="Overall" value={3} onChange={onChange} />);
    screen.getByRole('radio', { name: 'Nice' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it('digit keys select directly; Backspace and Delete clear', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RatingPicker label="Overall" value={2} onChange={onChange} />);
    screen.getByRole('radio', { name: 'Okay' }).focus();
    await user.keyboard('4');
    expect(onChange).toHaveBeenLastCalledWith(4);
    await user.keyboard('1');
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(null);
    onChange.mockClear();
    await user.keyboard('{Delete}');
    expect(onChange).toHaveBeenCalledWith(null);
    onChange.mockClear();
    await user.keyboard('0');
    await user.keyboard('6');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores keys pressed with Meta, Ctrl or Alt and leaves their default alone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RatingPicker label="Overall" value={2} onChange={onChange} />);
    const radio = screen.getByRole('radio', { name: 'Okay' });
    radio.focus();
    const prevented: string[] = [];
    // Registered on document so it runs after the group's React handler.
    const spy = (event: KeyboardEvent) => {
      if (event.defaultPrevented) prevented.push(event.key);
    };
    document.addEventListener('keydown', spy);
    await user.keyboard('{Meta>}1{/Meta}');
    await user.keyboard('{Control>}5{/Control}');
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await user.keyboard('{Meta>}{Backspace}{/Meta}');
    await user.keyboard('{Control>}{End}{/Control}');
    document.removeEventListener('keydown', spy);
    expect(onChange).not.toHaveBeenCalled();
    expect(prevented).toEqual([]);
  });

  it('Space and Enter on the focused radio toggle it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<RatingPicker label="Overall" value={2} onChange={onChange} />);
    screen.getByRole('radio', { name: 'Okay' }).focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(2);

    onChange.mockClear();
    screen.getByRole('radio', { name: 'Great' }).focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(4);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('read-only (no onChange) renders aria-disabled radios and ignores clicks and keys', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RatingPicker label="Overall" value={3} />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('aria-disabled', 'true');
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
      expect(radio).toHaveAttribute('tabindex', '-1');
    }
    await user.click(screen.getByRole('radio', { name: 'Love' }));
    screen.getByRole('radio', { name: 'Nice' }).focus();
    await user.keyboard('{ArrowRight}{Home}5{Backspace}{Enter} ');
    expect(screen.getByRole('radio', { name: 'Nice' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Love' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows names under the icons unless showNames is false', () => {
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={null} onChange={vi.fn()} />
    );
    for (const name of NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    rerender(<RatingPicker label="Overall" value={null} onChange={vi.fn()} showNames={false} />);
    for (const name of NAMES) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });

  it('titles the group with the checked name, and not at all when unrated', () => {
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={5} onChange={vi.fn()} />
    );
    expect(screen.getByRole('radiogroup')).toHaveAttribute('title', 'Love');
    rerender(<RatingPicker label="Overall" value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup')).not.toHaveAttribute('title');
  });

  // The lens is the sliding tile behind the checked segment (a non-button
  // child of the group); an unrated picker has no checked segment and no lens.
  it('draws the lens under the checked segment only', () => {
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={3} onChange={vi.fn()} />
    );
    const group = screen.getByRole('radiogroup');
    const lenses = () =>
      Array.from(group.children).filter(
        (el) => el.tagName !== 'BUTTON' && el.getAttribute('data-testid') !== 'rating-reveal'
      );
    expect(lenses()).toHaveLength(1);
    expect(group.style.getPropertyValue('--seg-count')).toBe('5');
    expect(group.style.getPropertyValue('--seg-index')).toBe('2');

    rerender(<RatingPicker label="Overall" value={null} onChange={vi.fn()} />);
    expect(lenses()).toHaveLength(0);
  });

  // The brand colour is not painted on the checked segment itself but on a
  // second copy of the row, clipped to the lens, so a segment lights up as
  // the lens passes over it — the mobile nav's reveal. No lens, no reveal.
  it('draws a decorative copy of every segment to reveal under the lens', () => {
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={3} onChange={vi.fn()} />
    );
    const reveal = screen.getByTestId('rating-reveal');
    expect(reveal).toHaveAttribute('aria-hidden', 'true');
    for (const name of NAMES) {
      expect(screen.getAllByText(name)).toHaveLength(2);
    }
    // Only the real segments are radios; the copy adds nothing to the tree.
    expect(screen.getAllByRole('radio')).toHaveLength(5);

    rerender(<RatingPicker label="Overall" value={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId('rating-reveal')).not.toBeInTheDocument();
    for (const name of NAMES) {
      expect(screen.getAllByText(name)).toHaveLength(1);
    }
  });

  it('paints its own track by default and none on the row surface', () => {
    const css = () =>
      Array.from(document.querySelectorAll('style'))
        .map((el) => el.textContent ?? '')
        .join('\n');
    const has = (group: HTMLElement, value: string) =>
      Array.from(group.classList).some((cls) =>
        new RegExp(`\\.${cls}\\s*\\{[^}]*background-color:\\s*${value}`).test(css())
      );
    const { rerender } = renderWithProviders(
      <RatingPicker label="Overall" value={null} onChange={vi.fn()} />
    );
    expect(has(screen.getByRole('radiogroup'), 'transparent')).toBe(false);
    rerender(<RatingPicker label="Overall" value={null} onChange={vi.fn()} surface="row" />);
    expect(has(screen.getByRole('radiogroup'), 'transparent')).toBe(true);
  });

  it('out-of-range value renders with nothing checked', () => {
    expect(() =>
      renderWithProviders(<RatingPicker label="Overall" value={0 as never} />)
    ).not.toThrow();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByRole('radiogroup')).not.toHaveAttribute('title');
  });
});
