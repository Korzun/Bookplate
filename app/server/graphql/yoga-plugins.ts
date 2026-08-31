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
 * Wiring for `cost-limit.ts`'s hand-rolled breadth+complexity walk
 * (query-cost-control plan — `cost-limit.ts`'s own doc comment has the full
 * counting model, the two enforced budgets, and their measured provenance).
 * Task 3 shipped this LOG-ONLY; **Task 4 arms it** — `costLimitRule` itself
 * now calls `context.reportError` when either `BREADTH_BUDGET` or
 * `COMPLEXITY_BUDGET` is exceeded (see that file), so installing this
 * plugin is what makes those two budgets actually reject a request, the
 * same way installing `useDepthLimit` is what makes `MAX_DEPTH` reject one.
 * Renamed from `useCostLogging` → `useCostLimit` to match `useDepthLimit`'s
 * naming now that it enforces, not just logs.
 *
 * Still logs `{operationName, breadth, complexity}` at info for EVERY
 * operation that reaches validation, accepted or rejected, unconditionally —
 * this is unchanged from Task 3: a measurement pass, not a guard, and an
 * operator wants to see what an attacker attempted just as much as what
 * real traffic costs. A REJECTED operation does not get a second, separate
 * WARN line from this plugin — `useOperationLogging`'s own `onValidate` hook
 * (below) already observes the shared validation result and logs exactly
 * one WARN line for any rejection, from any rule, the instant
 * `costLimitRule` starts calling `context.reportError` — see
 * `cost-limit.ts`'s own `costLimitRule` doc comment for why duplicating
 * that here would be redundant, not missing.
 *
 * Same `addValidationRule` seam as `useDepthLimit` and `useSchemaConcealment`.
 * Zero-arg, like its three siblings above — `costLimitRule` reads the
 * schema off `context.getSchema()` itself (task-3-review, M-2) rather than
 * this plugin threading one in.
 *
 * No query text or variables in the log line — same discipline
 * `useOperationLogging` documents for its own line, because either may carry
 * user data (a search filter today, a future password-bearing mutation's
 * input) that has no business in server logs.
 */
export const useCostLimit = (): Plugin => ({
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
 * post-`createContext` "no bearer token" value `onExecute` sees). A strict `=== null` check left this throwing `Cannot read
 * properties of undefined (reading 'userId')` from INSIDE the validation
 * pipeline for every rejected query — caught the hard way, by running the
 * M-4 regression test against this exact bug.
 */
const viewerIdOf = (context: Context): string =>
  context.viewer == null ? 'anon' : (context.viewer.userId ?? context.viewer.username);

/**
 * `viewerIdOf`'s counterpart for the `onValidate` hook specifically
 * (task-3 review N-3; final-review-wave disposition — narrower than first
 * recorded: ONLY `onValidate` was affected. `onExecute`
 * already logs the real viewer correctly, since `createContext` has run by
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
 * `onExecute` covers every query and mutation — which is the whole schema:
 * the `Subscription` root type was removed along with `scanProgress`, its
 * only field, so there is no `onSubscribe` hook here to pair with it.
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
 * `onExecute` keeps using `viewerIdOf` unchanged — `context` there is
 * already the fully-built post-`createContext` `Context`.
 */
export const useOperationLogging = (jwtSecret: Buffer): Plugin<Context> => ({
  onValidate: ({ context, params }) => {
    const start = Date.now();
    return ({ valid, result }) => {
      if (valid) return; // a clean validation logs nothing here — the
      // eventual onExecute call (if the operation goes on to run at all)
      // is the one line for a successful operation.
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
});
