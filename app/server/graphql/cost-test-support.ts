import {
  FragmentDefinitionNode,
  GraphQLError,
  Kind,
  OperationDefinitionNode,
  parse,
  specifiedRules,
  validate,
} from 'graphql';

import { costLimitRule, measureOperationCost, type OperationCost } from './cost-limit';
import { schema } from './schema';

/**
 * Test-only support shared by `cost-limit.test.ts` (rule-behaviour unit
 * tests: memoization, cycles, introspection exemption, arg pricing) and
 * `cost-calibration.test.ts` (the fixture corpus — headroom, separation, and
 * the printed table) — ONE implementation, not two copies that can drift.
 * Excluded from the production build the same way `test-util.ts` is (see
 * `tsconfig.json`'s own comment): this file exists purely to drive Vitest and
 * relies on `expect`/vitest's globals (`vite.config.ts`'s `test.globals:
 * true`), which the production `tsc --noEmit` build has no business
 * typechecking against.
 *
 * Moved out of `cost-limit.test.ts` verbatim
 * (`.superpowers/sdd/2026-08-03-cost-calibration-suite`, Task 2) — neither
 * function's behavior changed.
 */
export const operationAndFragmentsOf = (
  source: string
): { operation: OperationDefinitionNode; fragments: Record<string, FragmentDefinitionNode> } => {
  const document = parse(source);
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION
  );
  if (!operation) throw new Error('fixture has no operation');
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments[definition.name.value] = definition;
  }
  return { operation, fragments };
};

/** The pure `measureOperationCost` primitive, applied to a source string — no schema-validity check, no `costLimitRule`. Both test files call this directly for rule-behaviour boundary-math assertions; `accepts()` (below) is the one that ALSO gates on schema validity, for the fixture corpus. */
export const costOf = (source: string): OperationCost => {
  const { operation, fragments } = operationAndFragmentsOf(source);
  return measureOperationCost(operation, fragments, schema);
};

/** Runs `costLimitRule` (armed) via `validate()`, same as a real request would go through `yoga.ts`'s validation pipeline — used both by `accepts()` below and directly by tests asserting a REJECT verdict (and which code(s) fired). */
export const runCostLimitRule = (source: string): readonly GraphQLError[] =>
  validate(schema, parse(source), [costLimitRule(() => {})]);

/**
 * The schema-validity gate (`specifiedRules` — the same gate a client's
 * request actually goes through), on its own — task-4-review.md, I-2.
 * `costLimitRule` alone — unlike the real validation pipeline — never runs
 * `FieldsOnCorrectType` etc. (`fieldDefOf` treats an unresolvable field as a
 * childless leaf rather than an error, by design: "not an error here...
 * another rule's problem"), so a fixture that happens to be invalid GraphQL
 * can still produce a measured number without this check. That gap is
 * exactly how the number `13,483` — measured from an UNSENDABLE query — once
 * got baked into a budget derivation. `accepts()` (below) is this check plus
 * "and `costLimitRule` admits it"; `cost-calibration.test.ts`'s attack/reject
 * fixtures call this directly (they must be sendable but are NOT expected to
 * be admitted) — every fixture in the calibration corpus, ACCEPT or REJECT,
 * is checked against the real schema the same way a client's request
 * actually would be, before it is ever measured.
 */
export const assertSchemaValid = (source: string): void => {
  const schemaErrors = validate(schema, parse(source), specifiedRules);
  expect(schemaErrors).toEqual([]); // fail loudly if a fixture isn't real, sendable GraphQL.
};

/** `assertSchemaValid` plus "and `costLimitRule` admits it" — the full gate for an ACCEPT fixture. */
export const accepts = (source: string): void => {
  assertSchemaValid(source);
  expect(runCostLimitRule(source)).toEqual([]);
};
