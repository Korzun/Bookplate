import { useQuery } from '@apollo/client/react';
import { useLocation } from 'react-router';

import { useFragment } from '~/gql';
import { LibraryPendingFixesDocument, PendingFixRowFragment } from '~/graphql/upload';
import { BookIcon, DeviceIcon, SettingsIcon, UploadIcon, UsersIcon } from '~/icon';
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
  const uploadBadge: NavItem['badge'] = count > 0 ? count : active ? 'dot' : undefined;

  const items: NavItem[] = [
    {
      to: path.library(),
      label: 'Library',
      Icon: BookIcon,
      active: pathname.startsWith(path.library()),
    },
    {
      to: path.add(),
      label: 'Add',
      Icon: UploadIcon,
      // `startsWith`, not `===`: the tab must stay active on the `/add/request`
      // child route Task 3 adds. Same reason the Library item uses it.
      active: pathname.startsWith(path.add()),
      badge: uploadBadge,
    },
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
    {
      to: path.user(),
      label: 'Settings',
      Icon: SettingsIcon,
      active: pathname === path.user(),
    },
  ];

  return (
    <>
      <NavDesktop items={items} />
      <NavMobile items={items} />
    </>
  );
};
