import { logger } from './logger';

let stdoutSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;
const originalLogLevel = process.env.LOG_LEVEL;

beforeEach(() => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.env.LOG_LEVEL = originalLogLevel;
});

describe('logger format', () => {
  it('includes ISO timestamp, padded level, namespace, and message', () => {
    process.env.LOG_LEVEL = 'info';
    const log = logger('MyNS');
    log.info('hello world');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(output).toContain('INFO ');
    expect(output).toContain('[MyNS]');
    expect(output).toContain('hello world');
    expect(output).toMatch(/\n$/);
  });

  it('pads DEBUG to 5 chars', () => {
    process.env.LOG_LEVEL = 'debug';
    const log = logger('NS');
    log.debug('msg');
    expect(stdoutSpy.mock.calls[0][0]).toContain('DEBUG');
  });

  it('pads WARN to 5 chars', () => {
    const log = logger('NS');
    log.warn('msg');
    expect(stderrSpy.mock.calls[0][0]).toContain('WARN ');
  });
});

describe('logger level filtering', () => {
  it('emits info when LOG_LEVEL=info', () => {
    process.env.LOG_LEVEL = 'info';
    logger('NS').info('msg');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses debug when LOG_LEVEL=info', () => {
    process.env.LOG_LEVEL = 'info';
    logger('NS').debug('msg');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('emits debug when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'debug';
    logger('NS').debug('msg');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses info when LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    logger('NS').info('msg');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('emits warn when LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    logger('NS').warn('msg');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses warn when LOG_LEVEL=error', () => {
    process.env.LOG_LEVEL = 'error';
    logger('NS').warn('msg');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('defaults to info for unknown LOG_LEVEL value', () => {
    process.env.LOG_LEVEL = 'verbose';
    logger('NS').info('msg');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    logger('NS').debug('msg');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe('logger output streams', () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = 'debug';
  });

  it('writes debug to stdout', () => {
    logger('NS').debug('msg');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes info to stdout', () => {
    logger('NS').info('msg');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes warn to stderr', () => {
    logger('NS').warn('msg');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('writes error to stderr', () => {
    logger('NS').error('msg');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
