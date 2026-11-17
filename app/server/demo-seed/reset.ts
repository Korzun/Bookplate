import * as fs from 'fs';
import * as path from 'path';

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function assertSafe(dataDir: string, booksDir: string): void {
  for (const dir of [dataDir, booksDir]) {
    if (dir === path.parse(dir).root) {
      throw new Error(`Refusing to reset demo data: ${dir} is the filesystem root`);
    }
  }
  if (dataDir === booksDir) {
    throw new Error(`Refusing to reset demo data: data and books dirs are the same (${dataDir})`);
  }
  if (isInside(dataDir, booksDir)) {
    throw new Error(`Refusing to reset demo data: ${booksDir} is inside ${dataDir}`);
  }
  if (isInside(booksDir, dataDir)) {
    throw new Error(`Refusing to reset demo data: ${dataDir} is inside ${booksDir}`);
  }
}

function emptyDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Empties the contents of the data and library directories, keeping the
 * directories themselves (they are volume mount points). Validates both paths
 * before deleting anything.
 */
export function resetDemoDirs(dataDir: string, booksDir: string): void {
  const data = path.resolve(dataDir);
  const books = path.resolve(booksDir);
  assertSafe(data, books);
  emptyDir(data);
  emptyDir(books);
}
