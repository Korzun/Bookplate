import {
  getNamedType,
  isCompositeType,
  isInterfaceType,
  isObjectType,
  Kind,
  parse,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLSchema,
  type SelectionSetNode,
} from 'graphql';

import { cacheConfig } from './cache';

export type MissingKeyField = {
  typeName: string;
  /** Dotted path from the operation root, for a readable failure message. */
  path: string;
  missing: string[];
};

/**
 * The key fields Apollo will actually use for `type`, derived from the app's
 * own `cacheConfig` rather than restated here — change a typePolicy and this
 * follows automatically.
 *
 * An explicit `keyFields: []` (the root singletons) yields no requirement; a
 * type with no policy falls back to Apollo's default, which is `id` when the
 * type has one and inline storage otherwise.
 */
const keyFieldsFor = (type: GraphQLNamedType): string[] => {
  const policy = cacheConfig.typePolicies?.[type.name];
  if (policy && typeof policy === 'object' && 'keyFields' in policy) {
    const declared = policy.keyFields;
    return Array.isArray(declared)
      ? declared.filter((f): f is string => typeof f === 'string')
      : [];
  }
  if (!isObjectType(type) && !isInterfaceType(type)) return [];
  return 'id' in type.getFields() ? ['id'] : [];
};

/** Field names reachable in a selection set, following spreads that apply to `type`. */
const reachableFieldNames = (
  selectionSet: SelectionSetNode,
  type: GraphQLNamedType,
  fragments: Record<string, FragmentDefinitionNode>,
  seen: Set<string> = new Set()
): Set<string> => {
  const names = new Set<string>();
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      names.add(selection.name.value);
      continue;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const onName = selection.typeCondition?.name.value;
      if (onName && onName !== type.name) continue;
      for (const n of reachableFieldNames(selection.selectionSet, type, fragments, seen)) {
        names.add(n);
      }
      continue;
    }
    const fragmentName = selection.name.value;
    if (seen.has(fragmentName)) continue;
    seen.add(fragmentName);
    const definition = fragments[fragmentName];
    if (definition && definition.typeCondition.name.value === type.name) {
      for (const n of reachableFieldNames(definition.selectionSet, type, fragments, seen)) {
        names.add(n);
      }
    }
  }
  return names;
};

/**
 * Every selection set in `source` whose type is normalized by Apollo but which
 * omits that type's cache key field(s).
 */
export const findMissingKeyFields = (schema: GraphQLSchema, source: string): MissingKeyField[] => {
  const document = parse(source);
  const issues: MissingKeyField[] = [];

  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments[definition.name.value] = definition;
  }

  const check = (selectionSet: SelectionSetNode, type: GraphQLNamedType, path: string): void => {
    const required = keyFieldsFor(type);
    if (required.length === 0) return;
    const present = reachableFieldNames(selectionSet, type, fragments);
    const missing = required.filter((field) => !present.has(field));
    if (missing.length > 0) issues.push({ typeName: type.name, path, missing });
  };

  const walk = (
    selectionSet: SelectionSetNode,
    parentType: GraphQLNamedType,
    path: string
  ): void => {
    for (const selection of selectionSet.selections) {
      // Fragment spreads are walked at their own definition, below.
      if (selection.kind === Kind.FRAGMENT_SPREAD) continue;

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        const onName = selection.typeCondition?.name.value;
        const nextType = onName ? schema.getType(onName) : parentType;
        if (nextType && isCompositeType(nextType)) {
          check(selection.selectionSet, nextType, path);
          walk(selection.selectionSet, nextType, path);
        }
        continue;
      }

      if (!selection.selectionSet) continue;
      if (!isObjectType(parentType) && !isInterfaceType(parentType)) continue;
      const fieldDef = parentType.getFields()[selection.name.value];
      if (!fieldDef) continue;
      const namedType = getNamedType(fieldDef.type);
      if (!isCompositeType(namedType)) continue;

      const nextPath = `${path}.${selection.name.value}`;
      check(selection.selectionSet, namedType, nextPath);
      walk(selection.selectionSet, namedType, nextPath);
    }
  };

  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      const rootType =
        definition.operation === 'query'
          ? schema.getQueryType()
          : definition.operation === 'mutation'
            ? schema.getMutationType()
            : schema.getSubscriptionType();
      if (rootType) {
        walk(definition.selectionSet, rootType, definition.name?.value ?? '(anonymous)');
      }
      continue;
    }
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      const onType = schema.getType(definition.typeCondition.name.value);
      if (onType && isCompositeType(onType)) {
        const path = `fragment ${definition.name.value}`;
        check(definition.selectionSet, onType, path);
        walk(definition.selectionSet, onType, path);
      }
    }
  }

  return issues;
};
