import * as pathInternal from './path-internal';

export const book = (bookId: string) => pathInternal.book(encodeURIComponent(bookId));
export const bookEdit = (bookId: string) => pathInternal.bookEdit(encodeURIComponent(bookId));
export const home = () => pathInternal.home();
export const library = () => pathInternal.library();
export const series = (seriesName: string) => pathInternal.series(encodeURIComponent(seriesName));
export const upload = () => pathInternal.upload();
export const user = () => pathInternal.user();
export const userList = () => pathInternal.userList();
export const login = () => pathInternal.login();

// Server
export const cover = (bookId: string) => pathInternal.cover(encodeURIComponent(bookId));
