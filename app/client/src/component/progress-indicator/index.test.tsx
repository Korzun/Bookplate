// client/src/component/progress-indicator/index.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ProgressIndicator } from './index';

describe('ProgressIndicator', () => {
  it('renders "Not started" when value is 0', () => {
    renderWithProviders(<ProgressIndicator value={0} ariaLabel="Reading progress" />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('renders "Completed" when value is 1', () => {
    renderWithProviders(<ProgressIndicator value={1} ariaLabel="Reading progress" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders a percentage string for mid-range values', () => {
    renderWithProviders(<ProgressIndicator value={0.5} ariaLabel="Reading progress" />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does not render the SVG when value is 0', () => {
    const { container } = renderWithProviders(
      <ProgressIndicator value={0} ariaLabel="Reading progress" />
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('does not render the SVG when value is 1', () => {
    const { container } = renderWithProviders(
      <ProgressIndicator value={1} ariaLabel="Reading progress" />
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the SVG for in-progress values', () => {
    const { container } = renderWithProviders(
      <ProgressIndicator value={0.5} ariaLabel="Reading progress" />
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('clamps values below 0 to "Not started"', () => {
    renderWithProviders(<ProgressIndicator value={-0.5} ariaLabel="Reading progress" />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('clamps values above 1 to "Completed"', () => {
    renderWithProviders(<ProgressIndicator value={1.5} ariaLabel="Reading progress" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  // M-1 (2026-08-13 final review): `role="progressbar"` had no accessible
  // name — a screen reader announced a context-free "progressbar 50%".
  it('gives the progressbar an accessible name from the caller-supplied ariaLabel', () => {
    renderWithProviders(
      <ProgressIndicator value={0.5} ariaLabel="Reading progress for A Wizard of Earthsea" />
    );
    expect(
      screen.getByRole('progressbar', { name: 'Reading progress for A Wizard of Earthsea' })
    ).toBeInTheDocument();
  });
});
