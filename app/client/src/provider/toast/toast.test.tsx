import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { Toast } from './toast';

function renderToast(type: 'success' | 'error' | 'info') {
  return renderWithProviders(
    <Toast
      id={1}
      message="Scanning library…"
      type={type}
      isDismissing={false}
      duration={100000}
      onDismiss={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

describe('Toast', () => {
  it('renders an info toast with its message and an icon', () => {
    const { container } = renderToast('info');
    expect(screen.getByRole('status')).toHaveTextContent('Scanning library…');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('announces info and success politely, errors assertively', () => {
    const info = renderToast('info');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    info.unmount();

    const success = renderToast('success');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    success.unmount();

    renderToast('error');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'assertive');
  });
});
