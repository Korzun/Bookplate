export const book = (bookId: string) => `${library()}/book/${bookId}`;
export const bookEdit = (bookId: string) => `${library()}/book/${bookId}/edit`;
export const home = () => '/';
export const library = () => '/library';
export const login = () => '/login';
export const passwordReset = () => '/password-reset';
export const series = (seriesName: string) => `${library()}/series/${seriesName}`;
export const upload = () => '/upload';
export const user = () => '/user';
export const userList = () => '/users';

// Server
export const cover = (bookId: string) => `/api/books/${bookId}/cover`;
