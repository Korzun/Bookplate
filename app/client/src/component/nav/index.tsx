import { useQuery } from '@apollo/client/react';
import { useLocation } from 'react-router';

import { UserRowFragment } from '~/component/user-row';
import { useFragment } from '~/gql';
import { LibraryPendingFixesDocument, PendingFixRowFragment } from '~/graphql/upload';
import { UserListDocument } from '~/graphql/user';
import {
  AdjustmentsHorizontalIcon,
  BookIcon,
  DeviceIcon,
  HomeIcon,
  ListCheckIcon,
  SettingsIcon,
  UploadIcon,
  UsersIcon,
} from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { useCurrentLibraryId } from '~/provider/library-target';
import { useUploadQueue } from '~/provider/upload';
import { path } from '~/router';

import { NavDesktop } from '../nav-desktop';
import { NavMobile } from '../nav-mobile';
import type { NavItem } from './types';

// Owns the navigation destinations (which links exist, which is active, admin
// gating) and renders both layouts. Each layout hides itself at the wrong
// breakpoint via CSS, so only one is ever visible (and in the accessibility tree).
export const Nav = () => {
  const [isAdmin] = useIsAdmin();
  const { pathname } = useLocation();

  // ── The upload badge ──────────────────────────────────────────────────────
  //
  // `count` books have fixes awaiting a decision; a `'dot'` instead means an
  // upload is still running. Read here, at the only place that renders it —
  // this used to be a `useUploadBadge()` hook under `provider/upload`.
  //
  // **`count` reads the SERVER's live pending-fix rows**, not the upload
  // queue's merged `items`. Reading off the queue is only correct once
  // something has re-seeded it (an upload completing, or the queue engine
  // mounting); right after a reload, before either happens, the queue is
  // empty and the badge would under-report. The server row list carries the
  // same count with no such warm-up gap. `LibraryPendingFixesDocument` lives
  // in `~/graphql/upload.ts`, a leaf module, because the kept `UploadProvider`
  // reads it too — this is its second reader, and Apollo shares the one
  // in-flight request and the one normalized result between them.
  //
  // A row counts only when `state.proposals` is non-empty: a row can stay
  // "live" (`isLivePendingFix`'s 7-day TTL) with `proposals: []` after a
  // resolution, armed only for `undo` — that is not a fix awaiting a decision.
  //
  // SKIPPED while no library id is resolved: an admin with no library
  // selected has nothing to root `node(id:)` on.
  const { libraryId } = useCurrentLibraryId();
  const { data } = useQuery(LibraryPendingFixesDocument, {
    variables: { libraryId: libraryId ?? '' },
    skip: libraryId === undefined,
  });
  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const rows = useFragment(PendingFixRowFragment, library?.pendingFixes ?? []);
  const count = rows.filter((r) => r.state.proposals.length > 0).length;
  // `active` stays on the transport-backed queue — "an upload is in flight"
  // is knowledge only the client-side XHR transport has; no server read can
  // answer it. That is why the badge keeps BOTH sources.
  const { items: queueItems } = useUploadQueue();
  const active = queueItems.some((i) => i.status === 'queued' || i.status === 'uploading');

  // Admin only. `useWithTargetUser` already has this query in flight app-wide
  // for admins (the upload provider that calls it is mounted above the
  // router), so Apollo serves this from the same normalized result rather
  // than issuing a second request.
  //
  // The SELECTED library only. This used to mean "any reader is waiting", on
  // the reasoning that the switcher's per-user counts were visible only once
  // you were already on `/add` — that reasoning expired when the picker became
  // global chrome on every page (`router/nav-layout`). The overview lives
  // there now, so the dot can mean the narrower, actionable thing: there is
  // something waiting in the library you are actually working in.
  //
  // It matters because the dot reads as a call to action. Scoped to any
  // reader, it sent an admin with nothing selected to `/add`, which could only
  // answer "Select a library" — pointing at a prompt rather than at the work.
  //
  // A reader's OWN pending request sets nothing — it is a wait, not an
  // action. The read itself is gated `skip: !isAdmin` for that reason.
  const { data: userData } = useQuery(UserListDocument, { skip: !isAdmin });
  const userRefs = userData?.viewer.users ?? [];
  const usersForRequests = useFragment(UserRowFragment, userRefs);
  // Index-matched against the REFS, which carry `library { id }` as a sibling
  // of the fragment spread — the same match `useWithTargetUser` and
  // `component/library-switcher` already make, and the reason `library { id }`
  // is not in `UserRowFragment` itself (its ×50 cost warning).
  const selectedIndex = userRefs.findIndex((u) => u.library.id === libraryId);
  const selectedHasPendingRequests =
    selectedIndex !== -1 && usersForRequests[selectedIndex].pendingBookRequestCount > 0;

  // The NUMBER still means "fixes awaiting a decision" and nothing else —
  // only the dot arm gains a second trigger. Folding requests into `count`
  // was tried and rejected: a conflated count tells a reader neither of its
  // two populations.
  const uploadBadge: NavItem['badge'] = count > 0 ? count : active ? 'dot' : undefined;

  // Split off the Add tab's dot when Request became its own destination. The
  // dot used to mean "an upload is running OR a reader is waiting" because
  // both lived behind one tab; with two tabs, a dot on Add pointing at a
  // reader's request would send an admin to the wrong one. Add keeps what is
  // genuinely its own — fixes to decide, an upload in flight — and the wait
  // moves here.
  //
  // Admin-only by construction: `selectedHasPendingRequests` is read from a
  // query gated `skip: !isAdmin`, and a reader's own pending request
  // deliberately sets nothing — it is a wait, not an action.
  const requestBadge: NavItem['badge'] = selectedHasPendingRequests ? 'dot' : undefined;

  // Everything both layouts show, in order. The admin destinations differ
  // between them, so they are appended per layout below rather than folded in
  // here.
  const sharedLeading: NavItem[] = [
    {
      to: path.library(),
      label: 'Library',
      Icon: BookIcon,
      active: pathname.startsWith(path.library()),
    },
    {
      // Exact, not `startsWith`. It used to be `startsWith` so the tab stayed
      // lit on the `/add/request` child; that child is now `/request`, a
      // sibling with a tab of its own, and `startsWith` would light both.
      to: path.upload(),
      label: 'Upload',
      Icon: UploadIcon,
      active: pathname === path.upload(),
      badge: uploadBadge,
    },
    {
      to: path.request(),
      label: 'Request',
      Icon: ListCheckIcon,
      active: pathname === path.request(),
      badge: requestBadge,
    },
  ];

  const settings: NavItem = {
    to: path.user(),
    label: 'Settings',
    Icon: SettingsIcon,
    active: pathname === path.user(),
  };

  const onAdminRoute = pathname === path.userList() || pathname === path.devices();

  /**
   * TWO item lists, because the two layouts genuinely have different
   * destinations — the only thing in this component that is not shared.
   *
   * Desktop is a centred row with room to spare, so Users and Devices stay
   * where they are: nothing is buried on a screen that can afford to show it.
   *
   * Mobile is an equal-column grid inside a fixed-width capsule, so every tab
   * is as wide as the widest label and a sixth does not fit — measured at
   * 320px, where a six-tab capsule clips "Library" and "Settings" outright.
   * The two admin destinations collapse into one tab there, and the segmented
   * bar above the capsule picks between them.
   */
  const desktopItems: NavItem[] = [
    ...sharedLeading,
    ...(isAdmin
      ? [
          {
            to: path.userList(),
            label: 'Users',
            Icon: UsersIcon,
            active: pathname === path.userList(),
          },
          {
            to: path.devices(),
            label: 'Devices',
            Icon: DeviceIcon,
            active: pathname === path.devices(),
          },
        ]
      : []),
    settings,
  ];

  /**
   * SPIKE — the two-mode mobile nav.
   *
   * The capsule holds the three MAIN destinations and nothing else, with
   * single-destination buttons flanking it. Tapping settings collapses the
   * main group to one button and expands settings in its place, so the bar
   * never carries more than four targets however many destinations exist —
   * which is the fit problem solved structurally rather than by finding room
   * for one more tab.
   *
   * Route-driven, like everything else here: you are in settings mode because
   * of where you ARE, so nothing can desync from the URL and Back behaves.
   *
   * Admin only. A reader's settings holds exactly one destination, and a bar
   * that expands to show a single item is worse than one that does not expand
   * — so a reader keeps the default bar and the button goes straight to
   * `/user`. Splitting the account page into real sections is its own job;
   * when it lands, readers get this mode too.
   */
  const inSettings = isAdmin && (onAdminRoute || pathname === path.user());

  const settingsAccessory: NavItem = {
    to: path.user(),
    label: 'Settings',
    Icon: SettingsIcon,
    active: pathname === path.user(),
  };

  // The collapsed stand-in for the whole main group. Returns to Library
  // rather than to wherever you were: "where you were" is state this nav
  // deliberately does not keep, and guessing it wrong is worse than a
  // destination that is always the same.
  const collapsedMain: NavItem = {
    to: path.library(),
    label: 'Back to library',
    // `home`, not a book: this stands for the whole main group (Library, Add,
    // Request), not for the Library tab alone, and a second book icon beside
    // the one the Library tab already uses would read as a duplicate.
    Icon: HomeIcon,
    active: false,
  };

  // General FIRST. Tapping the settings button lands on `/user`, so whichever
  // item that is reads as "the one you just chose" — and landing on the third
  // of three looks like something was skipped past. It is also the only item
  // here every account has, which makes it the natural head of the list.
  const settingsItems: NavItem[] = [
    // Sliders rather than a second gear. The accessory that opens this mode is
    // already a gear, and at the far ends of the bar the same glyph twice read
    // as one control duplicated rather than two different places.
    {
      to: path.user(),
      label: 'General',
      Icon: AdjustmentsHorizontalIcon,
      active: pathname === path.user(),
    },
    { to: path.userList(), label: 'Users', Icon: UsersIcon, active: pathname === path.userList() },
    { to: path.devices(), label: 'Devices', Icon: DeviceIcon, active: pathname === path.devices() },
  ];

  return (
    <>
      <NavDesktop items={desktopItems} />
      {/* ONE bar with two sides, each able to be the expanded one. The sides
          are single elements that change width, which is what lets the capsule
          morph into the circle rather than cross-fade with it.

          A reader gets no expandable settings side — `items: []` — so their
          settings pill is permanently a circle and `/users` and `/devices`
          never enter their document. `expanded` is correspondingly always
          `main` for them, since `inSettings` is admin-gated above. */}
      <NavMobile
        main={{ items: sharedLeading, collapsed: collapsedMain }}
        settings={{ items: isAdmin ? settingsItems : [], collapsed: settingsAccessory }}
        expanded={inSettings ? 'settings' : 'main'}
      />
    </>
  );
};
