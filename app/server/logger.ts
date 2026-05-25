const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (raw in LEVELS ? raw : 'info') as Level;
}

function emit(level: Level, namespace: string, message: string): void {
  if (LEVELS[level] < LEVELS[currentLevel()]) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)} [${namespace}] ${message}\n`;
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export function logger(namespace: string) {
  return {
    debug: (msg: string) => emit('debug', namespace, msg),
    info: (msg: string) => emit('info', namespace, msg),
    warn: (msg: string) => emit('warn', namespace, msg),
    error: (msg: string) => emit('error', namespace, msg),
  };
}
