import { Request, Response, NextFunction } from 'express';
import type { MockedFunction } from 'vitest';

import { asyncHandler } from './async-handler';

describe('asyncHandler', () => {
  const req = {} as Request;
  const res = {} as Response;

  it('calls the wrapped fn and does NOT call next when it resolves', async () => {
    const next = vi.fn() as MockedFunction<NextFunction>;
    const fn = vi.fn().mockResolvedValue(undefined);
    const handler = asyncHandler(fn);

    handler(req, res, next);
    // Allow microtask queue to flush
    await Promise.resolve();

    expect(fn).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when the wrapped fn rejects', async () => {
    const next = vi.fn() as MockedFunction<NextFunction>;
    const boom = new Error('boom');
    const fn = vi.fn().mockRejectedValue(boom);
    const handler = asyncHandler(fn);

    handler(req, res, next);
    await Promise.resolve();
    // Give the rejection handler one more tick to run
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(boom);
  });
});
