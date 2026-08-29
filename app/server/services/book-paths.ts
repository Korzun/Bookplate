import * as path from 'path';

import { Owner } from '../types';

export function getStagingDir(booksRoot: string): string {
  return path.join(booksRoot, '.staging');
}

export function getUserDir(booksRoot: string, owner: Owner): string {
  return path.join(booksRoot, owner.username);
}

export function bookPath(booksRoot: string, owner: Owner, id: string): string {
  return path.join(getUserDir(booksRoot, owner), id + '.epub');
}
