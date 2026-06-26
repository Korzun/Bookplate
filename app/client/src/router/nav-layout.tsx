import { Outlet } from 'react-router-dom';

import { Nav } from '~/component/nav';

// Persistent layout for the main (nav-bearing) routes. Rendering <Nav /> here —
// rather than inside each page's <Page> — keeps it mounted across navigations, so
// the mobile nav's active-tab lens animates from the old tab to the new one instead
// of re-mounting and jumping into place.
export const NavLayout = () => (
  <>
    <Nav />
    <Outlet />
  </>
);
