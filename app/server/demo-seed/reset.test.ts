import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resetDemoDirs } from './reset';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-reset-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function populate(dir: string): void {
  fs.mkdirSync(path.join(dir, 'nested', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'nested', 'deep', 'inner.txt'), 'y');
}

describe('resetDemoDirs', () => {
  it('removes files and nested directories but keeps both directories', () => {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    populate(a);
    populate(b);

    resetDemoDirs(a, b);

    expect(fs.readdirSync(a)).toEqual([]);
    expect(fs.readdirSync(b)).toEqual([]);
  });

  it('creates directories that do not exist yet', () => {
    const a = path.join(root, 'new', 'a');
    const b = path.join(root, 'new', 'b');

    resetDemoDirs(a, b);

    expect(fs.readdirSync(a)).toEqual([]);
    expect(fs.readdirSync(b)).toEqual([]);
  });

  describe('refusals', () => {
    let x: string;
    let y: string;

    beforeEach(() => {
      x = path.join(root, 'x');
      y = path.join(root, 'y');
      populate(x);
      populate(y);
    });

    const expectRefusedAndIntact = (a: string, b: string, offending: string): void => {
      expect(() => resetDemoDirs(a, b)).toThrow(offending);
      expect(fs.existsSync(path.join(x, 'file.txt'))).toBe(true);
      expect(fs.existsSync(path.join(x, 'nested', 'deep', 'inner.txt'))).toBe(true);
      expect(fs.existsSync(path.join(y, 'file.txt'))).toBe(true);
    };

    it('refuses / as the data dir', () => {
      expectRefusedAndIntact('/', x, '/');
    });

    it('refuses / as the books dir', () => {
      expectRefusedAndIntact(x, '/', '/');
    });

    it('refuses identical paths', () => {
      expectRefusedAndIntact(x, x, x);
    });

    it('refuses when the books dir is inside the data dir', () => {
      expectRefusedAndIntact(x, path.join(x, 'books'), x);
    });

    it('refuses when the data dir is inside the books dir', () => {
      expectRefusedAndIntact(path.join(y, 'data'), y, y);
    });

    it('compares resolved paths (trailing slash)', () => {
      expectRefusedAndIntact(x, `${x}/`, x);
    });

    it('compares resolved paths (.. segments)', () => {
      expectRefusedAndIntact(x, path.join(y, '..', 'x'), x);
    });

    it('does not treat a sibling with a shared name prefix as nested', () => {
      const xx = path.join(root, 'x-sibling');
      fs.mkdirSync(xx);
      expect(() => resetDemoDirs(x, xx)).not.toThrow();
    });
  });
});
