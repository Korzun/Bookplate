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

  it.each(['left', 'center', 'right'] as const)('renders the label with align=%s', (align) => {
    renderWithProviders(<CardDivider align={align}>Cover</CardDivider>);
    expect(screen.getByText('Cover')).toBeInTheDocument();
  });

  it('renders actions alongside the label on the divider', () => {
    renderWithProviders(
      <CardDivider actions={<button>Apply all</button>}>Suggested fixes</CardDivider>
    );
    expect(screen.getByText('Suggested fixes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeInTheDocument();
  });

  it('renders actions on their own when there is no label', () => {
    renderWithProviders(<CardDivider actions={<button>Apply all</button>} />);
    expect(screen.getByRole('button', { name: 'Apply all' })).toBeInTheDocument();
  });

  it('stacks label before actions when they share a position', () => {
    renderWithProviders(
      <CardDivider align="left" actions={<button>Go</button>} actionsAlign="left">
        Label
      </CardDivider>
    );
    // Label renders before the action within the same group.
    expect(screen.getByRole('separator')).toHaveTextContent('LabelGo');
  });
});
