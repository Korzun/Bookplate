import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
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
      { id: 'u1', username: 'alice', progressCount: 0, library: { id: 'lib-alice' } },
      { id: 'u2', username: 'bob', progressCount: 0, library: { id: 'lib-bob' } },
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
  expect(screen.queryByRole('button', { name: 'Select library…' })).not.toBeInTheDocument();
  expect(vi.mocked(useUserList)).not.toHaveBeenCalled();
});

it("stores the selected user's library id, not their username", async () => {
  renderAsAdmin(<LibrarySwitcher />);
  await userEvent.click(await screen.findByRole('button', { name: 'Select library…' }));
  await userEvent.click(await screen.findByRole('option', { name: 'alice' }));
  expect(localStorage.getItem('library-target-id')).toBe('lib-alice');
});

it('clears a persisted target whose library id is missing from the loaded user list', async () => {
  localStorage.setItem('library-target-id', 'lib-ghost');
  renderAsAdmin(<LibrarySwitcher />);
  // The clear lands in an effect and the relabelled button in a later commit,
  // so these must retry together — asserting the DOM once after a wait keyed
  // on non-DOM state is the same race that flaked unlink-book-lineage-button.
  await waitFor(() => {
    expect(localStorage.getItem('library-target-id')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select library…' })).toBeInTheDocument();
  });
});

it('keeps a persisted target present in the loaded user list', async () => {
  localStorage.setItem('library-target-id', 'lib-bob');
  renderAsAdmin(<LibrarySwitcher />);
  expect(await screen.findByRole('button', { name: 'bob' })).toBeInTheDocument();
  expect(localStorage.getItem('library-target-id')).toBe('lib-bob');
});

it('keeps the persisted target while the user list is loading', () => {
  localStorage.setItem('library-target-id', 'lib-ghost');
  vi.mocked(useIsAdmin).mockReturnValue([true, false]);
  vi.mocked(useUserList).mockReturnValue([[], true, false, undefined]);
  render(
    <MemoryRouter>
      <ThemeProvider>
        <LibraryTargetProvider>
          <LibrarySwitcher />
        </LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  expect(localStorage.getItem('library-target-id')).toBe('lib-ghost');
});

it('keeps the persisted target when the user list is empty (not yet fetched)', () => {
  localStorage.setItem('library-target-id', 'lib-ghost');
  vi.mocked(useIsAdmin).mockReturnValue([true, false]);
  vi.mocked(useUserList).mockReturnValue([[], false, false, undefined]);
  render(
    <MemoryRouter>
      <ThemeProvider>
        <LibraryTargetProvider>
          <LibrarySwitcher />
        </LibraryTargetProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  expect(localStorage.getItem('library-target-id')).toBe('lib-ghost');
});
