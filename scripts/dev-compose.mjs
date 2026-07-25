// Host-side wrapper: derives a per-worktree Compose project name and free host
// ports, then execs `docker compose`. Run via `make dev` / `make dev-down`.

export function sanitizeProjectName(basename) {
  const slug = String(basename)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `bookplate-${slug}` : 'bookplate-dev';
}

// FNV-1a 32-bit — deterministic, dependency-free.
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function pickPort({ start, end, seed, isFree }) {
  const span = end - start + 1;
  const offset = hashString(seed) % span;
  for (let i = 0; i < span; i++) {
    const port = start + ((offset + i) % span);
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port in range ${start}-${end}`);
}
