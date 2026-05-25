// client/src/component/progress-indicator/index.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ProgressIndicator } from './index';

describe('ProgressIndicator', () => {
  it('renders "Not started" when value is 0', () => {
    renderWithProviders(<ProgressIndicator value={0} />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('renders "Completed" when value is 1', () => {
    renderWithProviders(<ProgressIndicator value={1} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders a percentage string for mid-range values', () => {
    renderWithProviders(<ProgressIndicator value={0.5} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does not render the SVG when value is 0', () => {
    const { container } = renderWithProviders(<ProgressIndicator value={0} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('does not render the SVG when value is 1', () => {
    const { container } = renderWithProviders(<ProgressIndicator value={1} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the SVG for in-progress values', () => {
    const { container } = renderWithProviders(<ProgressIndicator value={0.5} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('clamps values below 0 to "Not started"', () => {
    renderWithProviders(<ProgressIndicator value={-0.5} />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('clamps values above 1 to "Completed"', () => {
    renderWithProviders(<ProgressIndicator value={1.5} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
