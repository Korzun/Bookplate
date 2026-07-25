// Host-side wrapper: derives a per-worktree Compose project name and free host
// ports, then execs `docker compose`. Run via `make dev` / `make dev-down`.

import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const SERVER_RANGE = { start: 3000, end: 3099 };
const CLIENT_RANGE = { start: 5173, end: 5272 };

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

async function main() {
  const args = process.argv.slice(2); // e.g. ["up","--build"] or ["down"]
  const isDown = args.includes('down');
  const projectName = sanitizeProjectName(path.basename(process.cwd()));

  const env = { ...process.env, COMPOSE_PROJECT_NAME: projectName };

  if (!isDown) {
    const serverPort = await pickPort({
      ...SERVER_RANGE,
      seed: projectName,
      isFree: isPortFree,
    });
    const clientPort = await pickPort({
      ...CLIENT_RANGE,
      seed: projectName,
      isFree: isPortFree,
    });
    env.SERVER_PORT = String(serverPort);
    env.CLIENT_PORT = String(clientPort);
    console.log(`\n  Bookplate dev — project: ${projectName}`);
    console.log(`  Client UI:   http://localhost:${clientPort}/`);
    console.log(`  Server/OPDS: http://localhost:${serverPort}/\n`);
  }

  const child = spawn('docker', ['compose', ...args], { stdio: 'inherit', env });
  child.on('error', (err) => {
    console.error(`\n  dev-compose: failed to run 'docker' (${err.message})`);
    console.error(`  Tip: make sure Docker is installed and on your PATH.\n`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n  dev-compose: ${err.message}`);
    console.error(`  Tip: run 'make dev-down' in stale worktrees to free ports.\n`);
    process.exit(1);
  });
}
