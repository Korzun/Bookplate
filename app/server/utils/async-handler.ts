import { RequestHandler, Request, Response, NextFunction } from 'express';

/**
 * Wraps an async Express handler so a rejected promise is forwarded to the
 * error middleware via next(err) instead of becoming an unhandled rejection.
 * Express 4 does not await handler return values, so async handlers must be
 * wrapped for their rejections to be caught.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
