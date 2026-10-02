export const add = () => '/add';
/**
 * Requesting a book is its own destination, a SIBLING of `/add` rather than a
 * child of it. The two were one page with a toggle; they are now two nav
 * items, and a URL that still said `/add/request` would describe the old
 * shape.
 */
export const request = () => '/request';
/**
 * The URL `request()` replaced. Kept solely so `router/component.tsx` can
 * redirect it — a reader who bookmarked the Request view, or an admin who
 * sent someone the link, must not land on a 404 (here, the catch-all bounce
 * to the library, which would look like the feature was removed).
 */
export const legacyAddRequest = () => `${add()}/request`;
export const book = (bookId: string) => `${library()}/book/${bookId}`;
export const bookEdit = (bookId: string) => `${library()}/book/${bookId}/edit`;
export const devices = () => '/devices';
export const forgotPassword = () => '/forgot-password';
export const home = () => '/';
export const library = (options?: { subject?: string; author?: string }) => {
  const params = new URLSearchParams();
  if (options?.subject) params.set('subjects', options.subject);
  if (options?.author) params.set('author', options.author);
  const qs = params.toString();
  return qs ? `/library?${qs}` : '/library';
};
export const login = () => '/login';
export const passwordReset = () => '/password-reset';
/** The EMAIL reset flow. `passwordReset()` above is the protected forced-change
 *  screen and is a different thing — see the naming trap in the task brief. */
export const resetPasswordByEmail = () => '/reset-password';
export const series = (seriesName: string) => `/library/series/${seriesName}`;
export const setEmail = () => '/set-email';
export const user = () => '/user';
export const userList = () => '/users';
