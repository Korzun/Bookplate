import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithApollo } from '~/test-utils';

import { UserPage } from './index';

// `page/user` composes seven named exports from the `~/component` barrel
// (`ConnectionUrls`, `MyProgress`, `Page`, `ScanLibrarySetting`,
// `SyncPassword`, `ThemeSetting`, `UserChangePassword`), each of which owns
// its own GraphQL document/mutation and, in `ScanLibrarySetting`'s case, a
// scan-progress subscription. None of that is what this file tests — it
// tests `UserPage`'s OWN composition (which cards mount for which role) —
// so every one of those is replaced with a minimal stand-in naming itself.
// This is a plain `vi.mock` factory against the `~/component` BARREL (no
// `importOriginal()`), so it does not cross into the circular-import cycle
// `test-utils.tsx`'s standing note warns about (`page/library/index.test.tsx`
// takes the identical approach for the identical reason).
vi.mock('~/component', () => ({
  ConnectionUrls: () => <div>ConnectionUrls</div>,
  MyProgress: () => <div>MyProgress</div>,
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ScanLibrarySetting: () => <div>ScanLibrarySetting</div>,
  SyncPassword: () => <div>SyncPassword</div>,
  ThemeSetting: () => <div>ThemeSetting</div>,
  UserChangePassword: () => <div>UserChangePassword</div>,
}));

describe('UserPage', () => {
  // Task 6 (add-page reorg): the reader's `BookRequests` card is gone —
  // every request surface now lives on `/add/request`. `BookRequests` is no
  // longer even an EXPORT of `~/component` (see this file's own barrel
  // mock above, which would throw "element type is invalid" on render if
  // `page/user/index.tsx` still imported it) — a stronger pin than the text
  // query alone, which would pass vacuously against a page that never
  // rendered at all.
  it('no longer renders the book requests card', () => {
    renderWithApollo(<UserPage />, { user: { username: 'alice', isAdmin: false } });

    expect(screen.getByText('SyncPassword')).toBeInTheDocument();
    expect(screen.queryByText(/book requests/i)).not.toBeInTheDocument();
  });

  it('renders the admin branch without the reader-only cards', () => {
    renderWithApollo(<UserPage />, { user: { username: 'admin', isAdmin: true } });

    expect(screen.getByText('ScanLibrarySetting')).toBeInTheDocument();
    expect(screen.queryByText('SyncPassword')).not.toBeInTheDocument();
    expect(screen.queryByText(/book requests/i)).not.toBeInTheDocument();
  });
});
