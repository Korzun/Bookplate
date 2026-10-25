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

  // jsdom does no layout, so this checks the declared rule, not a measured width:
  // the sub-rating grid fits as many columns as there is room for rather than a
  // fixed two that overflowed narrow containers.
  it('lays the sub-ratings out in an auto-fit grid', () => {
    renderWithProviders(
      <BookRating rating={empty} bookTitle="Dune" readOnly={false} onRate={vi.fn()} />
    );
    const row = screen.getByRole('radiogroup', { name: 'Story rating for Dune' }).parentElement!;
    const grid = row.parentElement!;
    const css = Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
    const rule = new RegExp(
      `\\.${grid.className}\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(auto-fit,`
    );
    expect(css).toMatch(rule);
  });
});
