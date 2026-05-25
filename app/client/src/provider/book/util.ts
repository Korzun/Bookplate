import { Book } from './type';

export const bookSort = (bookA: Book, bookB: Book) => bookA.title.localeCompare(bookB.title);
