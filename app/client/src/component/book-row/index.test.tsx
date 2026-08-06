import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithApollo } from '~/test-utils';

import { BookRow } from './index';

const baseProps = {
  title: 'Dune',
  author: 'Frank Herbert',
  seriesIndex: 0,
  hasCover: true,
  coverSrc: 'blob:cover',
};

describe('BookRow (presentational)', () => {
  it('renders title and author with no progress or series index', () => {
    const { getByText, queryByText } = renderWithApollo(<BookRow {...baseProps} />);
    expect(getByText('Dune')).toBeInTheDocument();
    expect(getByText('Frank Herbert')).toBeInTheDocument();
    expect(queryByText(/%/)).toBeNull();
    expect(queryByText('Completed')).toBeNull();
  });

  it('joins author, series index and in-progress percentage into the meta line', () => {
    const { getByText } = renderWithApollo(
      <BookRow {...baseProps} seriesIndex={3} progressPercentage={0.42} />
    );
    expect(getByText('Frank Herbert · Book 3 · 42%')).toBeInTheDocument();
  });

  it('shows "Completed" once progress reaches 1', () => {
    const { getByText } = renderWithApollo(<BookRow {...baseProps} progressPercentage={1} />);
    expect(getByText('Frank Herbert · Completed')).toBeInTheDocument();
  });

  it('omits the author when showAuthor is false', () => {
    const { getByText, queryByText } = renderWithApollo(
      <BookRow {...baseProps} seriesIndex={2} showAuthor={false} />
    );
    expect(getByText('Book 2')).toBeInTheDocument();
    expect(queryByText('Frank Herbert')).toBeNull();
  });

  it('renders an img with the given coverSrc when hasCover is true', () => {
    const { getByRole } = renderWithApollo(<BookRow {...baseProps} coverSrc="blob:test" />);
    expect(getByRole('img')).toHaveAttribute('src', 'blob:test');
    expect(getByRole('img')).toHaveAttribute('alt', 'Dune');
  });

  it('renders the placeholder, not an img, when hasCover is false', () => {
    const { queryByRole } = renderWithApollo(
      <BookRow {...baseProps} hasCover={false} coverSrc={undefined} />
    );
    expect(queryByRole('img')).toBeNull();
  });

  it('fires onClick via the Card wrapper when asCard is true (the default)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByText } = renderWithApollo(<BookRow {...baseProps} onClick={onClick} />);
    await user.click(getByText('Dune'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires onClick directly on the row when asCard is false', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByText } = renderWithApollo(
      <BookRow {...baseProps} asCard={false} onClick={onClick} />
    );
    await user.click(getByText('Dune'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
