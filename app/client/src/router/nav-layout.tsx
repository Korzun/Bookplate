import { Outlet } from 'react-router';

import { Nav } from '~/component/nav';
import { TopFade } from '~/component/top-fade';
import { isStandalone } from '~/lib/is-standalone';

// Persistent layout for the main (nav-bearing) routes. Rendering <Nav /> here —
// rather than inside each page's <Page> — keeps it mounted across navigations, so
// the mobile nav's active-tab lens animates from the old tab to the new one instead
// of re-mounting and jumping into place.
export const NavLayout = () => (
  <>
    <Nav />
    {/* The top status-bar fade is only relevant when installed (standalone); in a
        browser tab the OS status bar isn't drawn over the page. */}
    {isStandalone() && <TopFade />}
    <Outlet />
  </>
);
