import { randomUUID } from 'crypto';

export type ScanResult = { imported: string[]; removed: string[] };
export type ScanJobStatus = 'running' | 'completed' | 'failed';

export type ScanJob = {
  jobId: string;
  status: ScanJobStatus;
  startedAt: number;
  result?: ScanResult;
  error?: string;
};

/**
 * In-memory, per-user scan job tracking. State is intentionally not persisted:
 * scans are user-triggered and cheap to re-run, so losing job state on restart
 * is acceptable. One job per user; starting a new one replaces any prior job.
 */
export class ScanJobStore {
  private readonly jobs = new Map<string, ScanJob>();

  start(userId: string): ScanJob {
    const job: ScanJob = { jobId: randomUUID(), status: 'running', startedAt: Date.now() };
    this.jobs.set(userId, job);
    return job;
  }

  complete(userId: string, result: ScanResult): void {
    const job = this.jobs.get(userId);
    if (job) {
      job.status = 'completed';
      job.result = result;
    }
  }

  fail(userId: string, error: string): void {
    const job = this.jobs.get(userId);
    if (job) {
      job.status = 'failed';
      job.error = error;
    }
  }

  get(userId: string): ScanJob | undefined {
    return this.jobs.get(userId);
  }

  isRunning(userId: string): boolean {
    return this.jobs.get(userId)?.status === 'running';
  }
}
