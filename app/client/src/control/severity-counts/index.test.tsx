import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { SeverityCounts } from './index';

describe('SeverityCounts', () => {
  it('renders only non-zero severities in canonical order', () => {
    renderWithProviders(
      <SeverityCounts counts={{ FATAL: 1, ERROR: 2, WARNING: 3, INFO: 0, USAGE: 0 }} />
    );
    expect(screen.getByText('1 Fatal')).toBeTruthy();
    expect(screen.getByText('2 Error')).toBeTruthy();
    expect(screen.getByText('3 Warning')).toBeTruthy();
    expect(screen.queryByText(/Info/)).toBeNull();
    expect(screen.queryByText(/Usage/)).toBeNull();
  });

  it('renders nothing when all counts are zero', () => {
    const { container } = renderWithProviders(
      <SeverityCounts counts={{ FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 }} />
    );
    expect(container.textContent).toBe('');
  });
});
