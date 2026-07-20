import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Nav } from './index';

describe('Nav', () => {
  it('hides the Users tab for non-admins', () => {
    renderWithProviders(<Nav />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/library'],
    });
    expect(screen.queryByText('Users')).toBeNull();
  });

  it('shows the Users tab for admins in both layouts', () => {
    renderWithProviders(<Nav />, {
      user: { username: 'admin', isAdmin: true },
      initialEntries: ['/library'],
    });
    // One link in the desktop layout, one in the mobile layout (CSS hides the
    // off-breakpoint one). Query links so the mobile blue-reveal copy isn't counted.
    expect(screen.getAllByRole('link', { name: 'Users' })).toHaveLength(2);
  });

  it('marks the current route active in both layouts', () => {
    renderWithProviders(<Nav />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/upload'],
    });
    const uploadLinks = screen.getAllByRole('link', { name: 'Upload' });
    expect(uploadLinks).toHaveLength(2);
    expect(uploadLinks.every((link) => link.getAttribute('aria-current') === 'page')).toBe(true);

    const libraryLinks = screen.getAllByRole('link', { name: 'Library' });
    expect(libraryLinks.every((link) => link.getAttribute('aria-current') === null)).toBe(true);
  });
});
