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
  it('labels each row, Overall first, matching the radiogroup order', () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const root = screen.getByRole('radiogroup', { name: 'Overall rating for Dune' }).parentElement!;
    const rows = Array.from(root.children);
    // Label, picker, label, picker…: ten children in strict alternation.
    expect(rows).toHaveLength(10);
    expect(rows.filter((_, i) => i % 2 === 0).map((el) => el.textContent)).toEqual([
      'Overall',
      'Story',
      'Characters',
      'Writing',
      'Ideas',
    ]);
    for (const [i, el] of rows.entries()) {
      expect(el.getAttribute('role')).toBe(i % 2 === 0 ? null : 'radiogroup');
    }
  });

  it('names the segments on the Overall row only', () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const overall = screen.getByRole('radiogroup', { name: 'Overall rating for Dune' });
    for (const name of ['Bad', 'Okay', 'Nice', 'Great', 'Awesome']) {
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
    await userEvent.click(within(group).getByRole('radio', { name: 'Awesome' }));
    expect(onRate).toHaveBeenCalledWith('story', 5);
  });

  it('passes readOnly through to every picker', () => {
    renderWithProviders(<BookRating rating={empty} bookTitle="Dune" readOnly onRate={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(25);
    for (const radio of radios) expect(radio).toHaveAttribute('aria-disabled', 'true');
  });

  // jsdom does no layout, so this checks the declared rules, not measured
  // widths: a label column and a picker column, collapsing to one column (label
  // above picker) at phone width.
  it('lays the rows out as label and picker columns, one column at phone width', () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const grid = screen.getByRole('radiogroup', { name: 'Story rating for Dune' }).parentElement!;
    const css = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    expect(css).toMatch(
      new RegExp(
        `\\.${grid.className}\\s*\\{[^}]*grid-template-columns:\\s*max-content minmax\\(0, 1fr\\)`
      )
    );
    expect(css).toMatch(
      new RegExp(
        `@media \\(max-width: 640px\\)\\s*\\{\\s*\\.${grid.className}\\s*\\{[^}]*grid-template-columns:\\s*minmax\\(0, 1fr\\)`
      )
    );
  });
});
