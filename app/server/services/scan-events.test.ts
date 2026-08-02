import {
  reduceScanJob,
  shouldPublish,
  SCAN_PUBLISH_COALESCE_MS,
  type ScanEvent,
  type ScanJob,
} from './scan-events';

const baseJob: ScanJob = {
  jobId: 'job-1',
  status: 'running',
  startedAt: 1_000,
  total: 0,
  processed: 0,
  phase: 'importing',
  currentFile: null,
  importedBookIds: [],
};

describe('reduceScanJob', () => {
  it('does not mutate the job it is given', () => {
    const before = JSON.parse(JSON.stringify(baseJob)) as ScanJob;
    reduceScanJob(baseJob, {
      type: 'progress',
      progress: {
        phase: 'importing',
        total: 3,
        processed: 1,
        filename: 'a.epub',
        outcome: 'imported',
        bookId: 'b1',
      },
    });
    expect(baseJob).toEqual(before);
  });

  it('returns a new object, not the same reference', () => {
    const next = reduceScanJob(baseJob, {
      type: 'complete',
      result: { imported: [], removed: [] },
    });
    expect(next).not.toBe(baseJob);
  });

  describe('progress events', () => {
    it('overwrites total/processed/phase/currentFile from an importing event', () => {
      const next = reduceScanJob(baseJob, {
        type: 'progress',
        progress: {
          phase: 'importing',
          total: 10,
          processed: 3,
          filename: 'book.epub',
          outcome: 'skipped',
        },
      });
      expect(next).toMatchObject({
        total: 10,
        processed: 3,
        phase: 'importing',
        currentFile: 'book.epub',
      });
      expect(next.status).toBe('running');
    });

    it('clears currentFile to null on a pruning event (no filename to report)', () => {
      const importing = reduceScanJob(baseJob, {
        type: 'progress',
        progress: {
          phase: 'importing',
          total: 1,
          processed: 1,
          filename: 'x.epub',
          outcome: 'skipped',
        },
      });
      const pruning = reduceScanJob(importing, {
        type: 'progress',
        progress: { phase: 'pruning', total: 2, processed: 1, bookId: 'stale1' },
      });
      expect(pruning.currentFile).toBeNull();
      expect(pruning.phase).toBe('pruning');
      expect(pruning.total).toBe(2);
      expect(pruning.processed).toBe(1);
    });

    it('appends bookId to importedBookIds on an "imported" outcome', () => {
      const next = reduceScanJob(baseJob, {
        type: 'progress',
        progress: {
          phase: 'importing',
          total: 1,
          processed: 1,
          filename: 'new.epub',
          outcome: 'imported',
          bookId: 'book-abc',
        },
      });
      expect(next.importedBookIds).toEqual(['book-abc']);
    });

    it('accumulates across multiple imported events, oldest first', () => {
      const step1 = reduceScanJob(baseJob, {
        type: 'progress',
        progress: {
          phase: 'importing',
          total: 2,
          processed: 1,
          filename: 'a.epub',
          outcome: 'imported',
          bookId: 'a-id',
        },
      });
      const step2 = reduceScanJob(step1, {
        type: 'progress',
        progress: {
          phase: 'importing',
          total: 2,
          processed: 2,
          filename: 'b.epub',
          outcome: 'imported',
          bookId: 'b-id',
        },
      });
      expect(step2.importedBookIds).toEqual(['a-id', 'b-id']);
    });

    it.each([
      ['renamed', 'r-id'],
      ['already-imported', 'ai-id'],
      ['skipped', 's-id'],
    ] as const)(
      'does NOT append to importedBookIds for a %s outcome, even with a bookId present',
      (outcome, bookId) => {
        const next = reduceScanJob(baseJob, {
          type: 'progress',
          progress: {
            phase: 'importing',
            total: 1,
            processed: 1,
            filename: 'x.epub',
            outcome,
            bookId,
          },
        });
        expect(next.importedBookIds).toEqual([]);
      }
    );

    it('leaves importedBookIds untouched for a pruning event', () => {
      const seeded: ScanJob = { ...baseJob, importedBookIds: ['already-there'] };
      const next = reduceScanJob(seeded, {
        type: 'progress',
        progress: { phase: 'pruning', total: 1, processed: 1, bookId: 'stale1' },
      });
      expect(next.importedBookIds).toEqual(['already-there']);
    });
  });

  describe('terminal events', () => {
    it('complete sets status to completed and attaches the result', () => {
      const next = reduceScanJob(baseJob, {
        type: 'complete',
        result: { imported: ['a.epub'], removed: ['x.epub'] },
      });
      expect(next.status).toBe('completed');
      expect(next.result).toEqual({ imported: ['a.epub'], removed: ['x.epub'] });
      expect(next.error).toBeUndefined();
    });

    it('fail sets status to failed and attaches the error message', () => {
      const next = reduceScanJob(baseJob, { type: 'fail', error: 'disk full' });
      expect(next.status).toBe('failed');
      expect(next.error).toBe('disk full');
      expect(next.result).toBeUndefined();
    });

    it('complete/fail preserve total/processed/phase/currentFile/importedBookIds already accumulated', () => {
      const progressed = reduceScanJob(baseJob, {
        type: 'progress',
        progress: {
          phase: 'importing',
          total: 5,
          processed: 2,
          filename: 'mid.epub',
          outcome: 'imported',
          bookId: 'mid-id',
        },
      });
      const completed = reduceScanJob(progressed, {
        type: 'complete',
        result: { imported: ['mid.epub'], removed: [] },
      });
      expect(completed.total).toBe(5);
      expect(completed.processed).toBe(2);
      expect(completed.currentFile).toBe('mid.epub');
      expect(completed.importedBookIds).toEqual(['mid-id']);
    });
  });
});

describe('shouldPublish', () => {
  const progressEvent: ScanEvent = {
    type: 'progress',
    progress: {
      phase: 'importing',
      total: 10,
      processed: 1,
      filename: 'a.epub',
      outcome: 'skipped',
    },
  };
  const completeEvent: ScanEvent = { type: 'complete', result: { imported: [], removed: [] } };
  const failEvent: ScanEvent = { type: 'fail', error: 'boom' };

  // Table-driven: (lastPublishedAt, now, event) -> expected. No fake timers —
  // the predicate is pure, so plain numbers exercise the boundary directly.
  it.each([
    // -- progress events: coalesce at the 250ms boundary --
    ['just published, well inside the window', 1_000, 1_100, progressEvent, false],
    [
      'exactly at the coalesce boundary',
      1_000,
      1_000 + SCAN_PUBLISH_COALESCE_MS,
      progressEvent,
      true,
    ],
    [
      'one ms before the boundary',
      1_000,
      1_000 + SCAN_PUBLISH_COALESCE_MS - 1,
      progressEvent,
      false,
    ],
    ['one ms after the boundary', 1_000, 1_000 + SCAN_PUBLISH_COALESCE_MS + 1, progressEvent, true],
    ['well past the window', 1_000, 5_000, progressEvent, true],
    ['now === lastPublishedAt (first tick of a burst)', 2_000, 2_000, progressEvent, false],
    [
      'never published before (lastPublishedAt 0), now still inside window',
      0,
      100,
      progressEvent,
      false,
    ],
    // -- terminal events: ALWAYS publish, coalescing window irrelevant --
    ['complete, published a moment ago', 1_000, 1_001, completeEvent, true],
    ['complete, now === lastPublishedAt', 1_000, 1_000, completeEvent, true],
    ['fail, published a moment ago', 1_000, 1_001, failEvent, true],
    ['fail, now === lastPublishedAt', 1_000, 1_000, failEvent, true],
  ] as const)('%s', (_label, lastPublishedAt, now, event, expected) => {
    expect(shouldPublish(lastPublishedAt, now, event)).toBe(expected);
  });
});
