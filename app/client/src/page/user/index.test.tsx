import { screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { UserPage } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({}),
    } as Response)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UserPage', () => {
  it('shows the password-change banner and hides sync password / progress when mustChangePassword is true', () => {
    renderWithProviders(<UserPage />, {
      user: { username: 'alice', isAdmin: false, mustChangePassword: true },
    });

    expect(
      screen.getByText('You must change your password before continuing.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Sync password')).not.toBeInTheDocument();
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
    expect(screen.getByText('Change password')).toBeInTheDocument();
  });

  it('does not show the banner and shows sync password / progress when mustChangePassword is false', () => {
    renderWithProviders(<UserPage />, {
      user: { username: 'alice', isAdmin: false, mustChangePassword: false },
    });

    expect(
      screen.queryByText('You must change your password before continuing.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Sync password')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });
});
