import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickPort, sanitizeProjectName } from './dev-compose.mjs';

test('sanitizeProjectName slugifies a normal basename', () => {
  assert.equal(
    sanitizeProjectName('development-server-auto-port'),
    'bookplate-development-server-auto-port'
  );
});

test('sanitizeProjectName lowercases and replaces spaces', () => {
  assert.equal(sanitizeProjectName('My Worktree'), 'bookplate-my-worktree');
});

test('sanitizeProjectName tolerates a leading digit', () => {
  assert.equal(sanitizeProjectName('123-foo'), 'bookplate-123-foo');
});

test('sanitizeProjectName falls back when nothing usable remains', () => {
  assert.equal(sanitizeProjectName('---'), 'bookplate-dev');
  assert.equal(sanitizeProjectName(''), 'bookplate-dev');
});

test('pickPort returns a deterministic base for a given seed', async () => {
  const seen = [];
  const port = await pickPort({
    start: 3000,
    end: 3099,
    seed: 'bookplate-alpha',
    isFree: (p) => {
      seen.push(p);
      return true;
    },
  });
  // First probe is the deterministic base; with everything free it is returned.
  assert.equal(port, seen[0]);
  assert.ok(port >= 3000 && port <= 3099);
  // Same seed → same base every time.
  const again = await pickPort({
    start: 3000,
    end: 3099,
    seed: 'bookplate-alpha',
    isFree: () => true,
  });
  assert.equal(port, again);
});

test('pickPort skips taken ports', async () => {
  const base = await pickPort({
    start: 3000,
    end: 3099,
    seed: 'seed-x',
    isFree: () => true,
  });
  const port = await pickPort({
    start: 3000,
    end: 3099,
    seed: 'seed-x',
    isFree: (p) => p !== base,
  });
  assert.notEqual(port, base);
});

test('pickPort wraps around the range', async () => {
  // Only the range start is free; base is somewhere in the middle → must wrap.
  const port = await pickPort({
    start: 3000,
    end: 3099,
    seed: 'seed-wrap',
    isFree: (p) => p === 3000,
  });
  assert.equal(port, 3000);
});

test('pickPort throws when the whole range is taken', async () => {
  await assert.rejects(
    pickPort({ start: 3000, end: 3002, seed: 'seed-full', isFree: () => false }),
    /No free port in range 3000-3002/
  );
});
