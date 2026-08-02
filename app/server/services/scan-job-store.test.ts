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

  it('start() seeds total/processed/phase/currentFile/importedBookIds to their empty defaults', () => {
    const store = new ScanJobStore();
    const job = store.start('u1');
    expect(job.total).toBe(0);
    expect(job.processed).toBe(0);
    expect(job.phase).toBe('importing');
    expect(job.currentFile).toBeNull();
    expect(job.importedBookIds).toEqual([]);
  });

  describe('progress()', () => {
    it('folds an importing progress event onto the running job', () => {
      const store = new ScanJobStore();
      store.start('u1');
      store.progress('u1', {
        phase: 'importing',
        total: 5,
        processed: 2,
        filename: 'book.epub',
        outcome: 'imported',
        bookId: 'b1',
      });
      const job = store.get('u1');
      expect(job?.total).toBe(5);
      expect(job?.processed).toBe(2);
      expect(job?.phase).toBe('importing');
      expect(job?.currentFile).toBe('book.epub');
      expect(job?.importedBookIds).toEqual(['b1']);
      expect(job?.status).toBe('running');
    });

    it('is a no-op when no job is tracked for the user', () => {
      const store = new ScanJobStore();
      expect(() =>
        store.progress('nobody', {
          phase: 'importing',
          total: 1,
          processed: 1,
          filename: 'x.epub',
          outcome: 'skipped',
        })
      ).not.toThrow();
      expect(store.get('nobody')).toBeUndefined();
    });

    it('accumulates importedBookIds across successive imported events', () => {
      const store = new ScanJobStore();
      store.start('u1');
      store.progress('u1', {
        phase: 'importing',
        total: 2,
        processed: 1,
        filename: 'a.epub',
        outcome: 'imported',
        bookId: 'a-id',
      });
      store.progress('u1', {
        phase: 'importing',
        total: 2,
        processed: 2,
        filename: 'b.epub',
        outcome: 'imported',
        bookId: 'b-id',
      });
      expect(store.get('u1')?.importedBookIds).toEqual(['a-id', 'b-id']);
    });
  });

  it('complete()/fail() carry forward progress already accumulated on the job (delegation, not a fresh object)', () => {
    const store = new ScanJobStore();
    store.start('u1');
    store.progress('u1', {
      phase: 'importing',
      total: 3,
      processed: 3,
      filename: 'last.epub',
      outcome: 'imported',
      bookId: 'last-id',
    });
    store.complete('u1', { imported: ['last.epub'], removed: [] });
    const job = store.get('u1');
    expect(job?.status).toBe('completed');
    expect(job?.total).toBe(3);
    expect(job?.processed).toBe(3);
    expect(job?.importedBookIds).toEqual(['last-id']);
  });

  it('complete()/fail() replace the stored job with a new object rather than mutating the old reference', () => {
    const store = new ScanJobStore();
    const started = store.start('u1');
    store.complete('u1', { imported: [], removed: [] });
    const completed = store.get('u1');
    expect(completed).not.toBe(started);
    // The originally-returned reference is untouched — proves the delegation
    // to reduceScanJob (no in-place `job.status = 'completed'`) reached all
    // the way through the class, not just internally.
    expect(started.status).toBe('running');
  });
});
