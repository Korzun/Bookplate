// Watches a release through the three-stage pipeline: the release/vX.Y.Z PR
// merging, `Release · Finalize` tagging it, then `Release · Publish` going
// green. Run it after `Release · Prepare` opens the PR:
//
//   node scripts/watch-release.mjs <pr-number> <version>
//   node scripts/watch-release.mjs 241 0.10.0
//
// Exits 0 once the release is published, 1 on a failed check or workflow, and
// 2 if the whole watch outlives its deadline.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node scripts/watch-release.mjs <pr-number> <version>';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function parseArgs(argv) {
  const [rawPr, rawVersion] = argv;
  if (!rawPr || !rawVersion) throw new Error(USAGE);
  if (!/^\d+$/.test(rawPr)) throw new Error(`not a PR number: ${rawPr}`);
  const version = rawVersion.replace(/^v/, '');
  if (!VERSION_RE.test(version)) throw new Error(`not a version: ${rawVersion}`);
  return { pr: Number(rawPr), version };
}

export function classifyPr(state) {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return 'waiting';
}

// A check only blocks the release once it can no longer turn green. SKIPPED is
// not one of those states — GitHub treats a skipped required check as passing.
const DEAD_CHECK_STATES = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED']);

export function findFailedChecks(checks) {
  return checks.filter((c) => DEAD_CHECK_STATES.has(c.state)).map((c) => c.name);
}

export function classifyRun(run) {
  if (!run || run.status !== 'completed') return 'waiting';
  return run.conclusion === 'success' ? 'success' : 'failure';
}

// Probes until `probe` returns something other than null/undefined. The clock
// and the sleep are injected so the tests can run without real time passing.
export async function pollUntil({ probe, intervalMs, timeoutMs, now, sleep, label = 'watch' }) {
  const startedAt = now();
  for (;;) {
    const result = await probe();
    if (result !== null && result !== undefined) return result;
    if (now() - startedAt >= timeoutMs) {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    await sleep(intervalMs);
  }
}

const REPO = 'Korzun/Bookplate';
const PUBLISH_WORKFLOW = 'release-publish.yml';

// `gh pr checks` exits non-zero while checks are pending or failing, so its
// stdout is what matters, not its exit code.
function parseJson(stdout, fallback) {
  if (!stdout.trim()) return fallback;
  try {
    return JSON.parse(stdout);
  } catch {
    return fallback;
  }
}

export async function watchRelease({ pr, version, gh, sleep, now, log, intervalMs, timeoutMs }) {
  const tag = `v${version}`;
  const poll = (label, probe) => pollUntil({ probe, intervalMs, timeoutMs, now, sleep, label });

  log(`Stage 1/3 — PR #${pr}: waiting for checks and auto-merge`);
  await poll(`PR #${pr}`, async () => {
    const checks = parseJson(
      (await gh(['pr', 'checks', String(pr), '--json', 'name,state'])).stdout,
      []
    );
    const failed = findFailedChecks(checks);
    if (failed.length > 0) throw new Error(`PR #${pr} checks failed: ${failed.join(', ')}`);

    const { state } = parseJson(
      (await gh(['pr', 'view', String(pr), '--json', 'state'])).stdout,
      {}
    );
    const verdict = classifyPr(state);
    if (verdict === 'closed') throw new Error(`PR #${pr} was closed without merging`);
    return verdict === 'merged' ? true : null;
  });
  log(`Stage 1/3 — PR #${pr} merged`);

  log(`Stage 2/3 — waiting for Release · Finalize to tag ${tag}`);
  const sha = await poll(`tag ${tag}`, async () => {
    const res = await gh(['api', `repos/${REPO}/git/ref/tags/${tag}`]);
    if (res.exitCode !== 0) return null;
    return parseJson(res.stdout, {})?.object?.sha ?? null;
  });
  log(`Stage 2/3 — tagged ${tag} at ${sha.slice(0, 8)}`);

  log('Stage 3/3 — waiting for Release · Publish');
  const publishRunId = await poll('Release · Publish', async () => {
    const [run] = parseJson(
      (
        await gh([
          'run',
          'list',
          '--workflow',
          PUBLISH_WORKFLOW,
          '--limit',
          '1',
          '--json',
          'status,conclusion,databaseId',
        ])
      ).stdout,
      []
    );
    const verdict = classifyRun(run);
    if (verdict === 'failure') {
      throw new Error(`Release · Publish failed (${run.conclusion}), run ${run.databaseId}`);
    }
    return verdict === 'success' ? run.databaseId : null;
  });
  log(`Stage 3/3 — Release · Publish succeeded (run ${publishRunId})`);

  return { tag, sha, publishRunId };
}

function runGh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) =>
      reject(new Error(`failed to run 'gh' (${err.message}). Is the GitHub CLI installed?`))
    );
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function main() {
  const { pr, version } = parseArgs(process.argv.slice(2));
  const stamp = () => new Date().toTimeString().slice(0, 8);

  const { tag, sha, publishRunId } = await watchRelease({
    pr,
    version,
    gh: runGh,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (msg) => console.log(`[${stamp()}] ${msg}`),
    intervalMs: 45_000,
    timeoutMs: 90 * 60_000,
  });

  const { stdout } = await runGh(['release', 'view', tag, '--json', 'url', '--jq', '.url']);
  console.log(`\n  ${tag} published at ${sha.slice(0, 8)} (publish run ${publishRunId})`);
  console.log(`  ${stdout.trim()}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n  watch-release: ${err.message}\n`);
    process.exit(/timed out/.test(err.message) ? 2 : 1);
  });
}
