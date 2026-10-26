import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { BookRating, type BookRatingValues } from './index';

const empty: BookRatingValues = {
  overall: null,
  story: null,
  characters: null,
  writing: null,
  ideas: null,
};
const withDetail: BookRatingValues = { ...empty, story: 5 };

const moreButton = () => screen.getByRole('button', { name: 'More' });
const lessButton = () => screen.getByRole('button', { name: 'Less' });

describe('BookRating', () => {
  it('is a card titled Rating with the More/Less button in its header, the Overall row, then one row per detail field, each a label then its radiogroup', () => {
    renderWithProviders(
      <BookRating rating={withDetail} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const overallRow = screen.getByRole('radiogroup', {
      name: 'Overall rating for Dune',
    }).parentElement!;
    const [first, details] = Array.from(overallRow.parentElement!.children);
    expect(first).toBe(overallRow);
    expect(lessButton()).toHaveAttribute('aria-controls', details.id);
    // Card: root > header > titleGroup > title; the header holds the button.
    const title = screen.getByText('Rating');
    const header = title.parentElement!.parentElement!;
    expect(header).toContainElement(lessButton());
    expect(header.parentElement).toContainElement(overallRow);
    const rows = [overallRow, ...Array.from(details.children)];
    expect(rows.map((row) => row.firstElementChild!.textContent)).toEqual([
      'Overall',
      'Story',
      'Characters',
      'Writing',
      'Ideas',
    ]);
    for (const row of rows) {
      expect(row.children).toHaveLength(2);
      expect(row.lastElementChild).toHaveAttribute('role', 'radiogroup');
    }
  });

  it('keeps the detail rows closed while none has a value, and opens them on More', async () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    expect(moreButton()).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(moreButton());
    expect(lessButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
    await userEvent.click(lessButton());
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  });

  it('opens the detail rows by itself when any detail has a value, and still closes on Less', async () => {
    renderWithProviders(
      <BookRating rating={withDetail} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    expect(lessButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
    await userEvent.click(lessButton());
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  });

  it('opens the detail rows when a detail value arrives later, unless the reader has already toggled', async () => {
    const props = { bookTitle: 'Dune', readOnly: false, onRate: vi.fn() };
    const { rerender } = renderWithProviders(<BookRating rating={empty} {...props} />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    rerender(<BookRating rating={withDetail} {...props} />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
    await userEvent.click(lessButton());
    rerender(<BookRating rating={{ ...withDetail, ideas: 2 }} {...props} />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
  });

  it('shows no button in a read-only view with no details, and Less when there are details', () => {
    const { unmount } = renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly onRate={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: /More|Less/ })).toBeNull();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    unmount();
    renderWithProviders(
      <BookRating rating={withDetail} bookTitle="Dune" readOnly onRate={vi.fn()} />
    );
    expect(lessButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('radiogroup')).toHaveLength(5);
  });

  it('names the segments on the Overall row only', () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const overall = screen.getByRole('radiogroup', { name: 'Overall rating for Dune' });
    for (const name of ['Bad', 'Okay', 'Nice', 'Great', 'Love']) {
      const matches = screen.getAllByText(name);
      expect(matches).toHaveLength(1);
      expect(overall).toContainElement(matches[0]);
    }
  });

  it('renders five radiogroups labelled for the book', () => {
    renderWithProviders(
      <BookRating rating={withDetail} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const names = screen.getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual([
      'Overall rating for Dune',
      'Story rating for Dune',
      'Characters rating for Dune',
      'Writing rating for Dune',
      'Ideas rating for Dune',
    ]);
  });

  it('reports the field and value on change', async () => {
    const onRate = vi.fn();
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={onRate} />
    );
    await userEvent.click(moreButton());
    const group = screen.getByRole('radiogroup', { name: 'Story rating for Dune' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Love' }));
    expect(onRate).toHaveBeenCalledWith('story', 5);
  });

  it('passes readOnly through to every picker', () => {
    renderWithProviders(
      <BookRating rating={withDetail} bookTitle="Dune" readOnly onRate={vi.fn()} />
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(25);
    for (const radio of radios) expect(radio).toHaveAttribute('aria-disabled', 'true');
  });

  // jsdom does no layout, so this checks the declared rules, not pixels: the
  // row is the shaded panel (its own background and radius; the picker inside
  // paints none, `surface="row"`), and it stacks label over picker at phone
  // width.
  it('each row is a shaded panel that stacks at phone width; the picker paints no track', () => {
    renderWithProviders(
      <BookRating rating={withDetail} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const group = screen.getByRole('radiogroup', { name: 'Story rating for Dune' });
    const row = group.parentElement!;
    const css = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    const rowRule = new RegExp(`\\.${row.className}\\s*\\{[^}]*`);
    expect(css.match(rowRule)![0]).toMatch(/background-color:/);
    expect(css.match(rowRule)![0]).toMatch(/border-radius:/);
    expect(css).toMatch(
      new RegExp(
        `@media \\(max-width: 640px\\)\\s*\\{\\s*\\.${row.className}\\s*\\{[^}]*flex-direction:\\s*column`
      )
    );
    const transparent = Array.from(group.classList).some((cls) =>
      new RegExp(`\\.${cls}\\s*\\{[^}]*background-color:\\s*transparent`).test(css)
    );
    expect(transparent).toBe(true);
  });
});
