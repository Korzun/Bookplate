import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { Card } from './index';

describe('Card', () => {
  it('renders footer content when a footer is provided', () => {
    renderWithProviders(
      <Card title="Title" footer={<button>Act</button>}>
        Body
      </Card>
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });

  it('renders a footer even when the card has no header', () => {
    renderWithProviders(<Card footer={<button>Act</button>}>Body</Card>);
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });

  it('hides the footer when a collapsible card is collapsed', () => {
    renderWithProviders(
      <Card title="Title" isCollapsible defaultCollapsed footer={<button>Act</button>}>
        Body
      </Card>
    );
    expect(screen.queryByRole('button', { name: 'Act' })).not.toBeInTheDocument();
  });

  it('does not render a footer when none is provided', () => {
    renderWithProviders(<Card title="Title">Body</Card>);
    expect(screen.queryByRole('button', { name: 'Act' })).not.toBeInTheDocument();
  });
});
