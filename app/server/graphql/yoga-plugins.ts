import {
  DocumentNode,
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  OperationDefinitionNode,
} from 'graphql';
import { isAsyncIterable, type Plugin } from 'graphql-yoga';

import { logger } from '../logger';
import { viewerFromHeader, type Context } from './context';
import { costLimitRule } from './cost-limit';
import { depthLimitRule, MAX_DEPTH } from './depth-limit';

// A distinct namespace from yoga.ts's own `logger('GraphQL')` (used there
// only to bridge yoga's internal diagnostic messages) — matches the
// sub-namespacing precedent `library/mutation/scan.ts` already sets with
// `logger('GraphQL:libraryScan')`, and keeps the two log streams
// unambiguous to grep (and, incidentally, to a test spying on one without
// the other).
const log = logger('GraphQL:operations');

/** graphql-js appends `Did you mean "…"?` to unknown field/type/argument errors. */
const SUGGESTION_PATTERN = /\s*Did you mean[\s\S]*$/;

const stripSuggestion = (error: unknown): unknown => {
  if (!(error instanceof GraphQLError) || !SUGGESTION_PATTERN.test(error.message)) return error;
  return new GraphQLError(error.message.replace(SUGGESTION_PATTERN, ''), {
    nodes: error.nodes,
    source: error.source,
    positions: error.positions,
    path: error.path,
    originalError: error.originalError,
    extensions: error.extensions,
  });
};

/**
 * Closes the two ways an unauthenticated caller could still read the schema.
 * Pothos's field wrapping cannot gate graphql-js meta-fields, so
 * `{ __schema { … } }` answers in full despite every field carrying the
 * `authenticated` scope; and a misspelled field name leaks real field names
 * back through validation's "Did you mean" suggestions. Installed only when
 * `isProduction` (yoga.ts) — dev keeps both so GraphiQL works.
 */
export const useSchemaConcealment = (): Plugin => ({
  onValidate: ({ addValidationRule }) => {
    addValidationRule(NoSchemaIntrospectionCustomRule);
    return ({ result, setResult }) => {
      const errors: readonly unknown[] = result;
      const stripped = errors.map(stripSuggestion);
      if (stripped.some((error, index) => error !== errors[index])) setResult(stripped);
    };
  },
});

/**
 * Rejects a query nested past `MAX_DEPTH` at validation time, before any
 * resolver runs — see depth-limit.ts's doc comment for the calibration
 * (measured against the library-grid screen query) and the amplification
 * cycle (`Book.series ↔ Series.books`) this exists to stop.
 *
 * Installed unconditionally, unlike `useSchemaConcealment`: this guards
 * against query-cost amplification, not information disclosure, so
 * GraphiQL's own queries in dev are exactly as capable of triggering it as
 * production traffic, and should be.
 */
export const useDepthLimit = (): Plugin => ({
  onValidate: ({ addValidationRule }) => addValidationRule(depthLimitRule(MAX_DEPTH)),
});

/** Distinct namespace from both `'GraphQL'` (yoga's own diagnostic bridge, yoga.ts) and `'GraphQL:operations'` (`useOperationLogging` below) — lets a test spy on this plugin's log line without also catching either of theirs, same reasoning `'GraphQL:operations'`'s own doc comment gives. */
const costLog = logger('GraphQL:cost');

/**
 * Log-only wiring for `cost-limit.ts`'s hand-rolled breadth+complexity walk
 * (query-cost-control plan, task 3 — `cost-limit.ts`'s own doc comment has
 * the full counting model and the reasoning behind it). Computes and logs
 * `{operationName, breadth, complexity}` at info for EVERY operation that
 * reaches validation — including one `useDepthLimit`/`useSchemaConcealment`
 * goes on to reject, deliberately: this is a measurement pass, not a guard,
 * and an operator watching for an eventual budget wants to see what an
 * attacker attempted just as much as what real traffic costs (the same
 * "cheapest available attack signal" reasoning `useOperationLogging`'s own
 * `onValidate` hook documents for M-4).
 *
 * Same `addValidationRule` seam as `useDepthLimit` and `useSchemaConcealment`
 * — `costLimitRule` NEVER calls `context.reportError`, so installing this
 * plugin cannot itself change what gets accepted or rejected; it exists
 * purely to run the walk and hand its numbers to `costLog.info` via the
 * callback `costLimitRule` invokes once per operation in the document.
 *
 * Zero-arg, like its three siblings above — `costLimitRule` reads the
 * schema off `context.getSchema()` itself (task-3-review, M-2) rather than
 * this plugin threading one in.
 *
 * No query text or variables in the log line — same discipline
 * `useOperationLogging` documents for its own line, because either may carry
 * user data (a search filter today, a future password-bearing mutation's
 * input) that has no business in server logs.
 */
export const useCostLogging = (): Plugin => ({
  onValidate: ({ addValidationRule }) =>
    addValidationRule(
      costLimitRule((operationName, cost) =>
        costLog.info(
          JSON.stringify({ operationName, breadth: cost.breadth, complexity: cost.complexity })
        )
      )
    ),
});

/**
 * Resolves the operation's name for logging. Falls back to `'anonymous'` for
 * an unnamed operation (`{ viewer { … } }` — the shape most of this schema's
 * own test corpus uses) rather than `undefined`, so every log line has the
 * same shape regardless of whether the caller named their operation.
 */
const operationNameOf = (document: DocumentNode, requested: string | null | undefined): string => {
  const match = document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION &&
      (requested == null || definition.name?.value === requested)
  );
  return match?.name?.value ?? 'anonymous';
};

/**
 * `'anon'` for a request with no viewer at all. The config-based admin's own
 * `userId` is null (it has no row in the users table — the same condition
 * `Viewer.library`/`Viewer.user` branch on, viewer/model.ts), so an
 * authenticated admin session logs under its username instead of falling
 * through to `'anon'` — a real, identifiable session should never read as
 * anonymous in an operator's logs.
 *
 * `== null` (not `=== null`), deliberately: at `onValidate` time (the
 * `onValidate` hook below), envelop has not yet run `createContext` — the
 * `context` payload there is the bare yoga-internal context, where `viewer`
 * is `undefined` (the property doesn't exist yet), not `null` (the
 * post-`createContext` "no bearer token" value `onExecute`/`onSubscribe`
 * see). A strict `=== null` check left this throwing `Cannot read
 * properties of undefined (reading 'userId')` from INSIDE the validation
 * pipeline for every rejected query — caught the hard way, by running the
 * M-4 regression test against this exact bug.
 */
const viewerIdOf = (context: Context): string =>
  context.viewer == null ? 'anon' : (context.viewer.userId ?? context.viewer.username);

/**
 * `viewerIdOf`'s counterpart for the `onValidate` hook specifically
 * (task-3 review N-3; final-review-wave disposition — narrower than first
 * recorded: ONLY `onValidate` was affected. `onExecute`/`onSubscribe`
 * already log the real viewer correctly, since `createContext` has run by
 * then — reproduced: an authenticated alice's `onExecute` line already
 * carried her real `userId`). At `onValidate` time `context.viewer` doesn't
 * exist yet (see `viewerIdOf`'s own doc comment above), so `viewerIdOf`
 * always fell through to `'anon'` here — even for an authenticated caller —
 * leaving the cheapest available attack signal (a depth-limit/introspection
 * probe) with no attribution: an operator could see SOMEONE probed the
 * limit, never which session.
 *
 * The object yoga hands `onValidate` before `createContext` runs is still
 * yoga's own `YogaInitialContext` (`request`, `params`), not yet the built
 * `Context` — hence the cast below, the same pre/post-`createContext`
 * shape mismatch `viewerIdOf`'s `== null` check already works around.
 * `request` IS present at this stage (it's part of yoga's initial
 * per-request context, set up before parse/validate ever run), so this
 * decodes the SAME bearer token `createContext` (context.ts) will decode
 * moments later, via the exact same `viewerFromHeader` — an onValidate-time
 * and an onExecute-time viewer for the same request can never disagree.
 * Needs `jwtSecret` threaded in (from `GraphqlHandlerDeps`, via
 * `useOperationLogging`'s own new parameter) because decoding a bearer
 * token requires it.
 */
const viewerIdAtValidate = (jwtSecret: Buffer, context: Context): string => {
  const request = (context as unknown as { request?: globalThis.Request }).request;
  const header = request?.headers.get('authorization') ?? undefined;
  const viewer = viewerFromHeader(jwtSecret, header);
  return viewer === null ? 'anon' : (viewer.userId ?? viewer.username);
};

const logOperation = (
  operationName: string,
  viewerId: string,
  durationMs: number,
  errorCount: number
): void => {
  const line = JSON.stringify({ operationName, viewerId, durationMs, errorCount });
  if (errorCount > 0) log.warn(line);
  else log.info(line);
};

/**
 * Per-operation completion logging: `{operationName, viewerId, durationMs,
 * errorCount}`, info for a clean result, warn once `errorCount > 0` (today
 * those demote to `requestLog`'s debug line, because every GraphQL response
 * is HTTP 200 to it — see server.ts's `requestLog`). NEVER the query text or
 * variables — either may carry user data (a search filter, a future
 * password-bearing mutation's input) that has no business in server logs.
 *
 * Installed unconditionally, same reasoning as `useDepthLimit`: this is
 * operator visibility, not an information-disclosure guard.
 *
 * `onExecute` covers every query and mutation. For the schema's one
 * subscription field (`scanProgress`), `onSubscribe`'s `onSubscribeResult`
 * splits in two:
 *   - a subscribe-time auth denial (`authorizeOnSubscribe: true`,
 *     builder.ts's own doc comment) is a single `ExecutionResult`, not a
 *     live stream — logged immediately, exactly like a query, in the
 *     `!isAsyncIterable` branch below.
 *   - a LIVE stream (subscribe succeeded) logs exactly ONCE, at completion
 *     (`onEnd`) — never per emitted event. A single scan can publish dozens
 *     of progress events over its lifetime; a log line per event would be
 *     noise, not signal, and would turn one long-lived operation into an
 *     unbounded number of log lines for no operator benefit. `errorCount`
 *     for that one line accumulates every event that carried an error, and
 *     `durationMs` spans the whole subscription's lifetime, not one event.
 *
 * `onValidate` covers the stage BEFORE either of those: a query rejected by
 * `useDepthLimit` or `useSchemaConcealment` never reaches `onExecute` at all
 * (yoga does not execute past a failed validation), so without this an
 * operator watching logs would see nothing while an attacker probed the
 * depth limit or introspection concealment — task-3 review, M-4: "one warn
 * line per validation rejection [is] the cheapest attack signal available."
 * `durationMs` here is the validation phase's own duration, not execution's.
 *
 * Takes `jwtSecret` (final-review-wave, N-3 fix) so its `onValidate` line
 * can attribute a validation-stage rejection to the real authenticated
 * viewer via `viewerIdAtValidate`, instead of always reading `'anon'`.
 * `onExecute`/`onSubscribe` keep using `viewerIdOf` unchanged — `context`
 * there is already the fully-built post-`createContext` `Context`.
 */
export const useOperationLogging = (jwtSecret: Buffer): Plugin<Context> => ({
  onValidate: ({ context, params }) => {
    const start = Date.now();
    return ({ valid, result }) => {
      if (valid) return; // a clean validation logs nothing here — the
      // eventual onExecute/onSubscribe call (if the operation goes on to
      // run at all) is the one line for a successful operation.
      logOperation(
        operationNameOf(params.documentAST, undefined),
        viewerIdAtValidate(jwtSecret, context),
        Date.now() - start,
        result.length
      );
    };
  },
  onExecute: ({ args }) => {
    const start = Date.now();
    return {
      onExecuteDone: ({ result }) => {
        if (isAsyncIterable(result)) return; // defer/stream — unused by this schema
        logOperation(
          operationNameOf(args.document, args.operationName),
          viewerIdOf(args.contextValue),
          Date.now() - start,
          result.errors?.length ?? 0
        );
      },
    };
  },
  onSubscribe: ({ args }) => {
    const start = Date.now();
    const operationName = operationNameOf(args.document, args.operationName);
    const viewerId = viewerIdOf(args.contextValue);
    return {
      onSubscribeResult: ({ result }) => {
        if (!isAsyncIterable(result)) {
          logOperation(operationName, viewerId, Date.now() - start, result.errors?.length ?? 0);
          return;
        }
        let errorCount = 0;
        return {
          onNext: ({ result: eventResult }) => {
            errorCount += eventResult.errors?.length ?? 0;
          },
          onEnd: () => {
            logOperation(operationName, viewerId, Date.now() - start, errorCount);
          },
        };
      },
    };
  },
});
