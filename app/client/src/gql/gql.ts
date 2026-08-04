/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n": typeof types.ViewerBootstrapDocument,
    "\n  query V {\n    viewer {\n      username\n    }\n  }\n": typeof types.VDocument,
    "\n  query P($id: ID!) {\n    node(id: $id) {\n      ... on Library {\n        id\n        progress(first: 1) {\n          edges {\n            node {\n              userId\n              document\n              percentage\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.PDocument,
};
const documents: Documents = {
    "\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n": types.ViewerBootstrapDocument,
    "\n  query V {\n    viewer {\n      username\n    }\n  }\n": types.VDocument,
    "\n  query P($id: ID!) {\n    node(id: $id) {\n      ... on Library {\n        id\n        progress(first: 1) {\n          edges {\n            node {\n              userId\n              document\n              percentage\n            }\n          }\n        }\n      }\n    }\n  }\n": types.PDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query V {\n    viewer {\n      username\n    }\n  }\n"): (typeof documents)["\n  query V {\n    viewer {\n      username\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query P($id: ID!) {\n    node(id: $id) {\n      ... on Library {\n        id\n        progress(first: 1) {\n          edges {\n            node {\n              userId\n              document\n              percentage\n            }\n          }\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query P($id: ID!) {\n    node(id: $id) {\n      ... on Library {\n        id\n        progress(first: 1) {\n          edges {\n            node {\n              userId\n              document\n              percentage\n            }\n          }\n        }\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;