import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from './config';

jest.mock('./logger');

let dataDir: string;
const originalEnv = { ...process.env };

function writeOptions(options: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify(options));
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-config-'));
  process.env = { ...originalEnv };
  process.env.DATA_DIR = dataDir;
  delete process.env.BOOKS_DIR;
});

afterEach(() => {
  process.env = { ...originalEnv };
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('loadConfig booksDir resolution', () => {
  it('defaults to /media/books when library_dir is absent', () => {
    writeOptions({ library_name: 'X' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('resolves a custom subpath under /media', () => {
    writeOptions({ library_dir: 'library/fiction' });
    expect(loadConfig().booksDir).toBe('/media/library/fiction');
  });

  it('strips leading slashes from the subpath', () => {
    writeOptions({ library_dir: '/books' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('falls back to /media/books when library_dir escapes /media', () => {
    writeOptions({ library_dir: '../escape' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('falls back to /media/books when library_dir is empty', () => {
    writeOptions({ library_dir: '   ' });
    expect(loadConfig().booksDir).toBe('/media/books');
  });

  it('keeps a directory name that merely begins with ".."', () => {
    writeOptions({ library_dir: '..books' });
    expect(loadConfig().booksDir).toBe('/media/..books');
  });

  it('lets BOOKS_DIR env var override library_dir', () => {
    process.env.BOOKS_DIR = '/media/override';
    writeOptions({ library_dir: 'library/fiction' });
    expect(loadConfig().booksDir).toBe('/media/override');
  });
});
