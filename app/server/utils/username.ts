// Usernames double as on-disk folder names under the books root, so they must
// be filesystem-safe: start alphanumeric (no hidden folders, no collision with
// the shared ".staging" folder), then letters/digits/dot/underscore/dash only.
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

// Minimum username length, enforced at registration (client + POST /api/users).
// Kept separate from isValidUsername, which is a charset / filesystem-safety
// check with no length component.
export const MIN_USERNAME_LENGTH = 6;

/**
 * Maps an arbitrary string to a valid username: invalid characters become
 * dashes, leading non-alphanumerics are stripped, and an empty result falls
 * back to "user". Used by the per-user-libraries migration to rename legacy
 * users whose names are not filesystem-safe.
 */
export function sanitizeUsername(username: string): string {
  const replaced = username.replace(/[^A-Za-z0-9._-]/g, '-');
  const stripped = replaced.replace(/^[^A-Za-z0-9]+/, '');
  return stripped || 'user';
}
