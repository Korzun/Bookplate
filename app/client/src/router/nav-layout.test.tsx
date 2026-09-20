import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { NavLayout } from './nav-layout';

// The nav itself is not under test here and drags in the upload queue and a
// pending-fix read; a stub keeps this suite about the layout's composition.
vi.mock('~/component/nav', () => ({ Nav: () => <div data-testid="nav" /> }));

const userListMock = (): MockedResponse<UserListQuery> => ({
  request: { query: UserListDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        users: [
          {
            __typename: 'User' as const,
            ...makeFragmentData(
              {
                __typename: 'User' as const,
                id: 'u1',
                username: 'alice',
                pendingBookRequestCount: 0,
                email: null,
                emailVerifiedAt: null,
              },
              UserRowFragment
            ),
            library: { __typename: 'Library' as const, id: 'lib-alice' },
          },
        ],
      },
    },
  },
});

/**
 * The REAL `LibrarySwitcher`, not a stub: it self-gates to admins by returning
 * `null`, and that gate is precisely what makes this layout need no `isAdmin`
 * branch of its own. Stubbing it would test the stub.
 */
const renderLayout = ({ isAdmin = false }: { isAdmin?: boolean } = {}) =>
  renderWithApollo(
    <Routes>
      <Route element={<NavLayout />}>
        <Route path="/library" element={<div>library page</div>} />
      </Route>
    </Routes>,
    {
      mocks: isAdmin ? [userListMock()] : [],
      initialEntries: ['/library'],
      user: { username: 'admin', isAdmin },
    }
  );

/**
 * The library picker is global chrome, not page content, and it lives here
 * rather than in a `component/page` slot for reasons that are structural:
 *
 *  - `Page` renders INSIDE `<main>`, below the desktop nav `<header>`, so a
 *    slot there could not put the picker above the navigation at all.
 *  - `Page` also serves the nav-less forced-password-change screen
 *    (`page/password-reset` uses `<Page type="minimal">`); an admin stuck
 *    there should not be switching libraries. `NavLayout` excludes it.
 *  - `Page` remounts on every navigation. Keeping the picker here is the same
 *    reasoning this layout's own doc comment gives for keeping `<Nav />` here.
 */
describe('NavLayout — the global library picker', () => {
  it('renders the picker above the nav for an admin', async () => {
    renderLayout({ isAdmin: true });

    const picker = await screen.findByRole('button', { name: 'Select user…' });
    const nav = screen.getByTestId('nav');
    // The nav FOLLOWS the picker in document order, which is what "above the
    // navigation" means for the desktop header. Asserting the relationship
    // rather than an index keeps this from breaking if other chrome lands
    // between them.
    expect(picker.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no picker for a reader', async () => {
    renderLayout({ isAdmin: false });

    // Positive control: the layout DID render, so this cannot pass vacuously.
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Select user…' })).not.toBeInTheDocument()
    );
  });

  it('renders no separator band above the nav for a reader', async () => {
    renderLayout({ isAdmin: false });

    // Nothing at all before the nav. The band carries a visible rule, so an
    // EMPTY wrapper is not good enough here — it would draw a line above a
    // picker that is not there. `&:empty { display: none }` cannot be trusted
    // for this either: jsdom applies no stylesheet, and more importantly the
    // band has a child element, so it is never `:empty` in the first place.
    expect(screen.getByTestId('nav').previousElementSibling).toBeNull();
  });

  /**
   * The band pushes the fixed mobile back / actions controls down so they do
   * not land on top of it (`nav-layout-style`), and that offset is only right
   * while the band is on screen — the page scrolls, the band goes with it, and
   * the controls, being fixed, do not. `useScrollOffsetProperty` publishes how
   * far the page has scrolled so the stylesheet can subtract it; this asserts
   * the layout turns it on for exactly the case that has a band.
   */
  it('publishes the page scroll offset for an admin, who has a band above the page', async () => {
    renderLayout({ isAdmin: true });
    await screen.findByRole('button', { name: 'Select user…' });

    expect(document.documentElement.style.getPropertyValue('--page-scroll-y')).toBe('0px');
  });

  it('publishes no scroll offset for a reader, who has no band', async () => {
    renderLayout({ isAdmin: false });

    // Positive control: absence proves nothing until the layout has rendered.
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    // Unset, not `0px` — an unset property is what leaves the controls' own
    // resting position standing.
    expect(document.documentElement.style.getPropertyValue('--page-scroll-y')).toBe('');
  });

  it('still renders the routed page', async () => {
    renderLayout({ isAdmin: true });

    expect(await screen.findByText('library page')).toBeInTheDocument();
  });
});
