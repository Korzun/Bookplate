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
});
