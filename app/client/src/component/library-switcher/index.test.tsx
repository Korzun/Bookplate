import { render, screen } from '@testing-library/react';
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
    <MemoryRouter>
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
    <MemoryRouter>
      <ThemeProvider>
        <LibraryTargetProvider>{ui}</LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

it('renders nothing for non-admin users', () => {
  renderAsUser(<LibrarySwitcher />);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(vi.mocked(useUserList)).not.toHaveBeenCalled();
});

it('lists users and selects a target library', async () => {
  renderAsAdmin(<LibrarySwitcher />);
  const select = await screen.findByRole('combobox');
  await userEvent.selectOptions(select, 'alice');
  expect(localStorage.getItem('library-target-user')).toBe('alice');
});
