import { RequestHandler, Request, Response, NextFunction } from 'express';

/** Express's default `req.params` shape, named so the generic below can default to it. */
type DefaultParams = Request['params'];

/**
 * Wraps an async Express handler so a rejected promise is forwarded to the
 * error middleware via next(err) instead of becoming an unhandled rejection.
 * Express 4 did not await handler return values, so async handlers had to be
 * wrapped; Express 5 forwards rejections itself, which makes this wrapper
 * redundant — its removal is a follow-up, kept out of the upgrade commit.
 *
 * Generic in the params shape so a call site can narrow `req.params` (which
 * the Express 5 types widen to `string | string[]`) by annotating the handler
 * as `req: Request<{ id: string }>`.
 */
export function asyncHandler<P = DefaultParams>(
  fn: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler<P> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
