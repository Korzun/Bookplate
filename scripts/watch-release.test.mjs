import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyPr,
  classifyRun,
  findFailedChecks,
  parseArgs,
  pollUntil,
  watchRelease,
} from './watch-release.mjs';

test('parseArgs reads a PR number and a version', () => {
  assert.deepEqual(parseArgs(['241', '0.10.0']), { pr: 241, version: '0.10.0' });
});

test('parseArgs accepts a prerelease version', () => {
  assert.deepEqual(parseArgs(['9', '0.11.0-rc.1']), { pr: 9, version: '0.11.0-rc.1' });
});

test('parseArgs tolerates a v prefix on the version', () => {
  assert.deepEqual(parseArgs(['9', 'v0.11.0']), { pr: 9, version: '0.11.0' });
});

test('parseArgs rejects a non-numeric PR', () => {
  assert.throws(() => parseArgs(['#241', '0.10.0']), /PR number/);
});

test('parseArgs rejects a malformed version', () => {
  assert.throws(() => parseArgs(['241', '0.10']), /version/);
});

test('parseArgs rejects missing arguments', () => {
  assert.throws(() => parseArgs([]), /usage/i);
});

test('classifyPr reports a merged PR', () => {
  assert.equal(classifyPr('MERGED'), 'merged');
});

test('classifyPr reports a PR closed without merging', () => {
  assert.equal(classifyPr('CLOSED'), 'closed');
});

test('classifyPr keeps waiting on an open PR', () => {
  assert.equal(classifyPr('OPEN'), 'waiting');
});

test('findFailedChecks names every check in a terminal bad state', () => {
  const checks = [
    { name: 'Lint', state: 'SUCCESS' },
    { name: 'Server tests', state: 'FAILURE' },
    { name: 'Client tests', state: 'PENDING' },
    { name: 'Docker smoke test', state: 'TIMED_OUT' },
    { name: 'Cost calibration', state: 'CANCELLED' },
  ];
  assert.deepEqual(findFailedChecks(checks), [
    'Server tests',
    'Docker smoke test',
    'Cost calibration',
  ]);
});

test('findFailedChecks returns nothing while checks are merely pending', () => {
  const checks = [
    { name: 'Lint', state: 'PENDING' },
    { name: 'Server tests', state: 'SUCCESS' },
  ];
  assert.deepEqual(findFailedChecks(checks), []);
});

test('findFailedChecks ignores a skipped check', () => {
  // A skipped required check does not block auto-merge, so it is not a failure.
  assert.deepEqual(findFailedChecks([{ name: 'Docker build', state: 'SKIPPED' }]), []);
});

test('classifyRun reports a successful completed run', () => {
  assert.equal(classifyRun({ status: 'completed', conclusion: 'success' }), 'success');
});

test('classifyRun reports a failed completed run', () => {
  assert.equal(classifyRun({ status: 'completed', conclusion: 'failure' }), 'failure');
});

test('classifyRun treats a cancelled run as a failure', () => {
  assert.equal(classifyRun({ status: 'completed', conclusion: 'cancelled' }), 'failure');
});

test('classifyRun keeps waiting on a queued or in-progress run', () => {
  assert.equal(classifyRun({ status: 'queued', conclusion: null }), 'waiting');
  assert.equal(classifyRun({ status: 'in_progress', conclusion: null }), 'waiting');
});

test('classifyRun keeps waiting when there is no run yet', () => {
  assert.equal(classifyRun(undefined), 'waiting');
});

test('pollUntil returns the first non-null probe result', async () => {
  const results = [null, null, 'tagged'];
  let calls = 0;
  const slept = [];
  const value = await pollUntil({
    probe: () => results[calls++],
    intervalMs: 45_000,
    timeoutMs: 600_000,
    now: () => 0,
    sleep: (ms) => slept.push(ms),
  });
  assert.equal(value, 'tagged');
  assert.equal(calls, 3);
  // Slept between probes, not after the one that succeeded.
  assert.deepEqual(slept, [45_000, 45_000]);
});

test('pollUntil throws a deadline error once the timeout passes', async () => {
  let clock = 0;
  await assert.rejects(
    pollUntil({
      probe: () => null,
      intervalMs: 45_000,
      timeoutMs: 90_000,
      now: () => (clock += 45_000),
      sleep: () => {},
    }),
    /timed out after 90s/
  );
});

test('pollUntil probes once even with a timeout of zero', async () => {
  let calls = 0;
  const value = await pollUntil({
    probe: () => {
      calls++;
      return 'immediate';
    },
    intervalMs: 1,
    timeoutMs: 0,
    now: () => 0,
    sleep: () => {},
  });
  assert.equal(value, 'immediate');
  assert.equal(calls, 1);
});

// A fake `gh` that answers the four calls watchRelease makes. Each queue entry
// is consumed in order, so a stage can be made to change its answer over time.
function fakeGh({ prStates, checks = [], tagShas, publishRuns }) {
  const next = (queue, fallback) => (queue.length > 1 ? queue.shift() : (queue[0] ?? fallback));
  const calls = [];
  const gh = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'pr' && args[1] === 'view') {
      return { exitCode: 0, stdout: JSON.stringify({ state: next(prStates) }) };
    }
    if (args[0] === 'pr' && args[1] === 'checks') {
      // Real `gh pr checks` exits 8 while any check is still pending.
      const pending = checks.some((c) => c.state === 'PENDING');
      return { exitCode: pending ? 8 : 0, stdout: JSON.stringify(checks) };
    }
    if (args[0] === 'api') {
      const sha = next(tagShas, null);
      if (!sha) return { exitCode: 1, stdout: '' };
      return { exitCode: 0, stdout: JSON.stringify({ object: { sha } }) };
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return { exitCode: 0, stdout: JSON.stringify(next(publishRuns, []) ?? []) };
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, calls };
}

const quiet = { sleep: () => {}, now: () => 0, log: () => {}, intervalMs: 1, timeoutMs: 1000 };

test('watchRelease resolves once the PR merges, the tag lands and publish succeeds', async () => {
  const { gh } = fakeGh({
    prStates: ['OPEN', 'MERGED'],
    checks: [{ name: 'Lint', state: 'SUCCESS' }],
    tagShas: [null, 'ed45e60ecafe'],
    publishRuns: [
      [{ status: 'in_progress', conclusion: null, databaseId: 77 }],
      [{ status: 'completed', conclusion: 'success', databaseId: 77 }],
    ],
  });

  const result = await watchRelease({ pr: 241, version: '0.10.0', gh, ...quiet });

  assert.deepEqual(result, { tag: 'v0.10.0', sha: 'ed45e60ecafe', publishRunId: 77 });
});

test('watchRelease fails naming the checks that went red', async () => {
  const { gh } = fakeGh({
    prStates: ['OPEN'],
    checks: [
      { name: 'Lint', state: 'SUCCESS' },
      { name: 'Server tests', state: 'FAILURE' },
      { name: 'Docker smoke test', state: 'TIMED_OUT' },
    ],
  });

  await assert.rejects(
    watchRelease({ pr: 241, version: '0.10.0', gh, ...quiet }),
    /Server tests, Docker smoke test/
  );
});

test('watchRelease fails when the release PR is closed without merging', async () => {
  const { gh } = fakeGh({ prStates: ['CLOSED'] });

  await assert.rejects(
    watchRelease({ pr: 241, version: '0.10.0', gh, ...quiet }),
    /closed without merging/
  );
});

test('watchRelease fails when the publish workflow concludes badly', async () => {
  const { gh } = fakeGh({
    prStates: ['MERGED'],
    checks: [{ name: 'Lint', state: 'SUCCESS' }],
    tagShas: ['ed45e60ecafe'],
    publishRuns: [[{ status: 'completed', conclusion: 'failure', databaseId: 77 }]],
  });

  await assert.rejects(
    watchRelease({ pr: 241, version: '0.10.0', gh, ...quiet }),
    /Release · Publish failed \(failure\), run 77/
  );
});

test('watchRelease does not poll the PR again after it has merged', async () => {
  const { gh, calls } = fakeGh({
    prStates: ['MERGED'],
    checks: [{ name: 'Lint', state: 'SUCCESS' }],
    tagShas: ['ed45e60ecafe'],
    publishRuns: [[{ status: 'completed', conclusion: 'success', databaseId: 77 }]],
  });

  await watchRelease({ pr: 241, version: '0.10.0', gh, ...quiet });

  assert.equal(calls.filter((c) => c.startsWith('pr view')).length, 1);
});
