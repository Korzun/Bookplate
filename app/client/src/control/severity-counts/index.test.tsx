import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { SeverityCounts } from './index';

describe('SeverityCounts', () => {
  it('renders only non-zero severities in canonical order', () => {
    renderWithProviders(
      <SeverityCounts
        counts={{ FATAL: 1, ERROR: 2, WARNING: 3, INFO: 0, USAGE: 0 }}
        threshold="ERROR"
      />
    );
    expect(screen.getByText('1 Fatal')).toBeTruthy();
    expect(screen.getByText('2 Error')).toBeTruthy();
    expect(screen.getByText('3 Warning')).toBeTruthy();
    expect(screen.queryByText(/Info/)).toBeNull();
    expect(screen.queryByText(/Usage/)).toBeNull();
  });

  it('marks severities at or above the threshold as blocking', () => {
    renderWithProviders(
      <SeverityCounts
        counts={{ FATAL: 1, ERROR: 0, WARNING: 2, INFO: 0, USAGE: 0 }}
        threshold="WARNING"
      />
    );
    expect(screen.getByText('1 Fatal').getAttribute('data-blocking')).toBe('true');
    expect(screen.getByText('2 Warning').getAttribute('data-blocking')).toBe('true');
  });

  it('marks severities below the threshold as non-blocking', () => {
    renderWithProviders(
      <SeverityCounts
        counts={{ FATAL: 1, ERROR: 0, WARNING: 2, INFO: 0, USAGE: 0 }}
        threshold="ERROR"
      />
    );
    expect(screen.getByText('1 Fatal').getAttribute('data-blocking')).toBe('true');
    expect(screen.getByText('2 Warning').getAttribute('data-blocking')).toBe('false');
  });

  it('renders nothing when all counts are zero', () => {
    const { container } = renderWithProviders(
      <SeverityCounts
        counts={{ FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 }}
        threshold="ERROR"
      />
    );
    expect(container.textContent).toBe('');
  });
});
