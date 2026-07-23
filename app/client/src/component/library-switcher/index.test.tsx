import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { useIsAdmin } from '~/provider/auth';
import { LibraryTargetProvider } from '~/provider/library-target';
import { ThemeProvider } from '~/provider/theme/provider';
import { useUserList } from '~/provider/user';

import { LibrarySwitcher } from '.';

vi.mock('~/provider/auth', () => ({
  useIsAdmin: vi.fn(),
}));

vi.mock('~/provider/user', () => ({
  useUserList: vi.fn(),
}));

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function renderAsUser(ui: ReactNode) {
  vi.mocked(useIsAdmin).mockReturnValue([false, false]);
  vi.mocked(useUserList).mockReturnValue([[], false, false, undefined]);

  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <LibraryTargetProvider>{ui}</LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function renderAsAdmin(ui: ReactNode) {
  vi.mocked(useIsAdmin).mockReturnValue([true, false]);
  vi.mocked(useUserList).mockReturnValue([
    [
      { username: 'alice', progressCount: 0 },
      { username: 'bob', progressCount: 0 },
    ],
    false,
    false,
    undefined,
  ]);

  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <LibraryTargetProvider>{ui}</LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

it('renders nothing for non-admin users', () => {
  renderAsUser(<LibrarySwitcher />);
  expect(screen.queryByRole('button', { name: 'Select library…' })).not.toBeInTheDocument();
  expect(vi.mocked(useUserList)).not.toHaveBeenCalled();
});

it('lists users and selects a target library', async () => {
  renderAsAdmin(<LibrarySwitcher />);
  await userEvent.click(await screen.findByRole('button', { name: 'Select library…' }));
  await userEvent.click(await screen.findByRole('option', { name: 'alice' }));
  expect(localStorage.getItem('library-target-user')).toBe('alice');
});

it('clears a persisted target missing from the loaded user list', async () => {
  localStorage.setItem('library-target-user', 'ghost');
  renderAsAdmin(<LibrarySwitcher />);
  await waitFor(() => expect(localStorage.getItem('library-target-user')).toBeNull());
  expect(screen.getByRole('button', { name: 'Select library…' })).toBeInTheDocument();
});

it('keeps a persisted target present in the loaded user list', async () => {
  localStorage.setItem('library-target-user', 'bob');
  renderAsAdmin(<LibrarySwitcher />);
  expect(await screen.findByRole('button', { name: 'bob' })).toBeInTheDocument();
  expect(localStorage.getItem('library-target-user')).toBe('bob');
});

it('keeps the persisted target while the user list is loading', () => {
  localStorage.setItem('library-target-user', 'ghost');
  vi.mocked(useIsAdmin).mockReturnValue([true, false]);
  vi.mocked(useUserList).mockReturnValue([[], true, false, undefined]);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <LibraryTargetProvider>
          <LibrarySwitcher />
        </LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  expect(localStorage.getItem('library-target-user')).toBe('ghost');
});

it('keeps the persisted target when the user list is empty (not yet fetched)', () => {
  localStorage.setItem('library-target-user', 'ghost');
  vi.mocked(useIsAdmin).mockReturnValue([true, false]);
  vi.mocked(useUserList).mockReturnValue([[], false, false, undefined]);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <LibraryTargetProvider>
          <LibrarySwitcher />
        </LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  expect(localStorage.getItem('library-target-user')).toBe('ghost');
});
