import * as fs from 'fs';
import * as path from 'path';

import { isValidUsername } from './username';

/**
 * Recursively removes a user's on-disk books directory (`<booksRoot>/<username>/`),
 * mirroring REST's `DELETE /api/users/:username` (`routes/users.ts`, removed
 * in Phase 0) — extracted verbatim from that route before its removal so the
 * GraphQL `userDelete` mutation (`graphql/schema/user/mutation/delete.ts`)
 * can call the identical cleanup rather than carrying its own copy that
 * could drift from REST's. Behaviour is unchanged from the route's original
 * inline version: `force: true` makes a
 * missing directory a silent no-op (the row could already have no folder, e.g.
 * a legacy/never-scanned account), and the `isValidUsername` guard is
 * defensive — a username that somehow reached this point without being
 * filesystem-safe is left alone rather than resolved into some other path via
 * `..` segments (`isValidUsername`'s own doc comment: usernames double as
 * folder names for exactly this reason).
 */
export function removeUserBooksDir(booksRoot: string, username: string): void {
  if (!isValidUsername(username)) return;
  fs.rmSync(path.join(booksRoot, username), { recursive: true, force: true });
}
