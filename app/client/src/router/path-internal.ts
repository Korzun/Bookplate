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
export const upload = () => '/upload';
export const user = () => '/user';
export const userList = () => '/users';

// Server
export const cover = (bookId: string) => `/api/books/${bookId}/cover`;
