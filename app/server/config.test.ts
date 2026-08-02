import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadConfig } from './config';

vi.mock('./logger');

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
  delete process.env.VALIDATION_THRESHOLD;
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

describe('loadConfig validation threshold', () => {
  it('defaults to ERROR when the option is unset', () => {
    writeOptions({ library_name: 'X' });
    expect(loadConfig().validationThreshold).toBe('ERROR');
  });

  it('maps each picker label to the library value', () => {
    const cases = [
      ['Fatal', 'FATAL'],
      ['Error', 'ERROR'],
      ['Warning', 'WARNING'],
      ['Info', 'INFO'],
    ] as const;
    for (const [label, expected] of cases) {
      writeOptions({ validation_threshold: label });
      expect(loadConfig().validationThreshold).toBe(expected);
    }
  });

  it('parses the label case-insensitively', () => {
    writeOptions({ validation_threshold: 'wArNiNg' });
    expect(loadConfig().validationThreshold).toBe('WARNING');
  });

  it('falls back to ERROR for an unrecognized value', () => {
    writeOptions({ validation_threshold: 'bogus' });
    expect(loadConfig().validationThreshold).toBe('ERROR');
  });

  it('lets VALIDATION_THRESHOLD env var override the option', () => {
    process.env.VALIDATION_THRESHOLD = 'Info';
    writeOptions({ validation_threshold: 'Warning' });
    expect(loadConfig().validationThreshold).toBe('INFO');
  });
});

// Review I-2's contained trust-proxy fix: the config knob's own conservative-
// default requirement, enforced at the parse boundary so a malformed env var
// can only ever fail SAFE (toward "trust nothing").
describe('loadConfig trustProxyHops', () => {
  it('defaults to 0 when neither TRUST_PROXY_HOPS nor the add-on option is set', () => {
    delete process.env.TRUST_PROXY_HOPS;
    expect(loadConfig().trustProxyHops).toBe(0);
  });

  it('parses a positive integer from the TRUST_PROXY_HOPS env var (bare-metal/dev path)', () => {
    process.env.TRUST_PROXY_HOPS = '2';
    expect(loadConfig().trustProxyHops).toBe(2);
  });

  it('falls back to 0 for zero, negative, or non-numeric env var values (never trust by accident)', () => {
    for (const raw of ['0', '-1', 'nope', '']) {
      process.env.TRUST_PROXY_HOPS = raw;
      expect(loadConfig().trustProxyHops).toBe(0);
    }
  });

  // Review D-1: the Home Assistant add-on has no env-var surface at all
  // (`run.sh` execs `node` with no arguments) — `options.json`, sourced
  // from `config.yaml`'s `trust_proxy_hops` schema entry, is the ONLY path
  // an add-on user can reach this knob through. Mirrors
  // `validation_threshold`'s options.json test pattern immediately above,
  // the closest sibling knob that (like this one, post-fix) is readable
  // from both an env var and an add-on option.
  it('reads trust_proxy_hops from options.json (Home Assistant add-on path)', () => {
    delete process.env.TRUST_PROXY_HOPS;
    writeOptions({ trust_proxy_hops: 1 });
    expect(loadConfig().trustProxyHops).toBe(1);
  });

  it('falls back to 0 for a zero, negative, or malformed options.json value', () => {
    delete process.env.TRUST_PROXY_HOPS;
    for (const raw of [0, -1, 'not-a-number']) {
      writeOptions({ trust_proxy_hops: raw });
      expect(loadConfig().trustProxyHops).toBe(0);
    }
  });

  it('lets TRUST_PROXY_HOPS env var override the add-on option, same precedence as validationThreshold', () => {
    process.env.TRUST_PROXY_HOPS = '3';
    writeOptions({ trust_proxy_hops: 1 });
    expect(loadConfig().trustProxyHops).toBe(3);
  });
});
