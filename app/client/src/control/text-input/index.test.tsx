import { screen } from '@testing-library/react';

import { renderWithProviders } from '~/test-utils';

import { TextInput } from './index';

const counter = /^\d+\/\d+$/;

it('shows a character counter as the field approaches its limit', () => {
  renderWithProviders(<TextInput name="name" value={'a'.repeat(95)} maxLength={100} />);
  expect(screen.getByText('95/100')).toBeInTheDocument();
});

it('hides the counter while the field is far from its limit', () => {
  renderWithProviders(<TextInput name="name" value={'a'.repeat(50)} maxLength={100} />);
  expect(screen.queryByText('50/100')).not.toBeInTheDocument();
});

it('shows the counter for a short field only near the limit', () => {
  // Threshold floor is 10 chars, so a 50-char field stays clean until 40.
  const { rerender } = renderWithProviders(
    <TextInput name="name" value={'a'.repeat(39)} maxLength={50} />
  );
  expect(screen.queryByText(counter)).not.toBeInTheDocument();

  rerender(<TextInput name="name" value={'a'.repeat(41)} maxLength={50} />);
  expect(screen.getByText('41/50')).toBeInTheDocument();
});

it('renders no counter when maxLength is not set', () => {
  renderWithProviders(<TextInput name="name" value={'a'.repeat(95)} />);
  expect(screen.queryByText(counter)).not.toBeInTheDocument();
});
