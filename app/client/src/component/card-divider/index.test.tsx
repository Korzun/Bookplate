import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { CardDivider } from './index';

describe('CardDivider', () => {
  it('renders a separator with no label by default', () => {
    renderWithProviders(<CardDivider />);
    const sep = screen.getByRole('separator');
    expect(sep).toBeInTheDocument();
    expect(sep.textContent).toBe('');
  });

  it('renders the optional label text when provided', () => {
    renderWithProviders(<CardDivider>Cover</CardDivider>);
    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toHaveTextContent('Cover');
  });
});
