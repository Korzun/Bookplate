import { ScanJobStore } from './scan-job-store';

describe('ScanJobStore', () => {
  it('start() records a running job and returns it', () => {
    const store = new ScanJobStore();
    const job = store.start('u1');
    expect(job.status).toBe('running');
    expect(typeof job.jobId).toBe('string');
    expect(job.jobId).not.toHaveLength(0);
    expect(typeof job.startedAt).toBe('number');
    expect(store.isRunning('u1')).toBe(true);
    expect(store.get('u1')).toBe(job);
  });

  it('complete() marks the job completed with a result', () => {
    const store = new ScanJobStore();
    store.start('u1');
    store.complete('u1', { imported: ['a'], removed: [] });
    const job = store.get('u1');
    expect(job?.status).toBe('completed');
    expect(job?.result).toEqual({ imported: ['a'], removed: [] });
    expect(store.isRunning('u1')).toBe(false);
  });

  it('fail() marks the job failed with an error', () => {
    const store = new ScanJobStore();
    store.start('u1');
    store.fail('u1', 'boom');
    const job = store.get('u1');
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('boom');
    expect(store.isRunning('u1')).toBe(false);
  });

  it('isolates jobs per user', () => {
    const store = new ScanJobStore();
    store.start('u1');
    expect(store.isRunning('u2')).toBe(false);
    expect(store.get('u2')).toBeUndefined();
  });

  it('start() replaces a previous terminal job for the same user', () => {
    const store = new ScanJobStore();
    const first = store.start('u1');
    store.complete('u1', { imported: [], removed: [] });
    const second = store.start('u1');
    expect(second.jobId).not.toBe(first.jobId);
    expect(store.isRunning('u1')).toBe(true);
  });

  it('complete()/fail() are no-ops when no job exists', () => {
    const store = new ScanJobStore();
    expect(() => store.complete('nobody', { imported: [], removed: [] })).not.toThrow();
    expect(() => store.fail('nobody', 'x')).not.toThrow();
    expect(store.get('nobody')).toBeUndefined();
  });
});
