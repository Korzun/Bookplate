import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { APP_VERSION, readVersionFrom, UNKNOWN_VERSION } from './app-version';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-version-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePackageJson(contents: string): string {
  const file = path.join(dir, 'package.json');
  fs.writeFileSync(file, contents);
  return file;
}

describe('readVersionFrom', () => {
  it('reads the version field', () => {
    expect(readVersionFrom(writePackageJson('{"name":"bookplate","version":"1.2.3"}'))).toBe(
      '1.2.3'
    );
  });

  // Each of these is a broken deployment rather than a normal state, so they
  // report null and let the caller decide — which is the whole point of the
  // change: a cosmetic startup log line must not be able to kill the process,
  // the way the old `import ... from '../../package.json'` did.
  it('reports null when the file is missing', () => {
    expect(readVersionFrom(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('reports null when the file is not valid JSON', () => {
    expect(readVersionFrom(writePackageJson('{ not json'))).toBeNull();
  });

  it('reports null when there is no version field', () => {
    expect(readVersionFrom(writePackageJson('{"name":"bookplate"}'))).toBeNull();
  });

  it('reports null when version is not a string', () => {
    expect(readVersionFrom(writePackageJson('{"version":42}'))).toBeNull();
  });
});

describe('APP_VERSION', () => {
  it('is the workspace package.json version, resolved under the test layout', () => {
    const real: unknown = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), '../../package.json'), 'utf8')
    );
    expect(APP_VERSION).toBe((real as { version: string }).version);
    expect(APP_VERSION).not.toBe(UNKNOWN_VERSION);
  });
});
