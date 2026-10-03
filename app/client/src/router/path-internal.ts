/**
 * Uploading and requesting are two destinations, named for what they do.
 *
 * Both were once one `/add` page with a segmented toggle, which is where the
 * old names came from. The nav calls them Upload and Request, and a URL that
 * still said `/add` would describe a page that no longer exists.
 */
export const upload = () => '/upload';
export const request = () => '/request';
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
