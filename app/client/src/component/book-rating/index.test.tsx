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

describe('BookRating', () => {
  it('renders one row per field, Overall first, each a label then its radiogroup', () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const firstRow = screen.getByRole('radiogroup', {
      name: 'Overall rating for Dune',
    }).parentElement!;
    const rows = Array.from(firstRow.parentElement!.children);
    expect(rows).toHaveLength(5);
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
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
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
    const group = screen.getByRole('radiogroup', { name: 'Story rating for Dune' });
    await userEvent.click(within(group).getByRole('radio', { name: 'Love' }));
    expect(onRate).toHaveBeenCalledWith('story', 5);
  });

  it('passes readOnly through to every picker', () => {
    renderWithProviders(<BookRating rating={empty} bookTitle="Dune" readOnly onRate={vi.fn()} />);
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
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
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
