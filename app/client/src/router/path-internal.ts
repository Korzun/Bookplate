/** The Request child's own segment. Exported so `router/component.tsx` declares
 *  the nested route with the same constant `addRequest()` builds from, and the
 *  two cannot drift apart. Not a route PARAMETER, so it does not belong in
 *  `path-key-internal.ts` — that file holds only `:id`-style keys. */
export const ADD_REQUEST_SEGMENT = 'request';
export const add = () => '/add';
export const addRequest = () => `${add()}/${ADD_REQUEST_SEGMENT}`;
export const book = (bookId: string) => `${library()}/book/${bookId}`;
export const bookEdit = (bookId: string) => `${library()}/book/${bookId}/edit`;
export const devices = () => '/devices';
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
export const series = (seriesName: string) => `/library/series/${seriesName}`;
export const user = () => '/user';
export const userList = () => '/users';
