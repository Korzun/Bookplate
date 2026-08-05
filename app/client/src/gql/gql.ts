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
    "\n  query DeviceList {\n    viewer {\n      devices {\n        id\n        name\n        slug\n        coverWidth\n        coverHeight\n        coverFit\n        bwCover\n        simplify\n      }\n    }\n  }\n": typeof types.DeviceListDocument,
    "\n  mutation DeviceCreate($input: DeviceCreateInput!) {\n    deviceCreate(input: $input) {\n      __typename\n      ... on DeviceCreatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n": typeof types.DeviceCreateDocument,
    "\n  mutation DeviceUpdate($input: DeviceUpdateInput!) {\n    deviceUpdate(input: $input) {\n      __typename\n      ... on DeviceUpdatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n": typeof types.DeviceUpdateDocument,
    "\n  mutation DeviceDelete($input: DeviceDeleteInput!) {\n    deviceDelete(input: $input) {\n      __typename\n      ... on DeviceDeletePayload {\n        deletedDeviceId\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n": typeof types.DeviceDeleteDocument,
    "\n  fragment ScanStatusFields on ScanStatus {\n    id\n    state\n    phase\n    processed\n    total\n    currentFile\n    startedAt\n    error\n    result {\n      imported {\n        id\n        title\n      }\n      # The string list the ScanResult tuple has always carried (REST parity).\n      # imported is [Book!]! and is NOT interchangeable with it.\n      importedFilenames\n      removed\n    }\n  }\n": typeof types.ScanStatusFieldsFragmentDoc,
    "\n  query LibraryScanStatus($libraryId: ID!) {\n    node(id: $libraryId) {\n      id\n      ... on Library {\n        id\n        user {\n          id\n        }\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n": typeof types.LibraryScanStatusDocument,
    "\n  subscription ScanProgress($libraryId: ID!) {\n    scanProgress(libraryId: $libraryId) {\n      ...ScanStatusFields\n    }\n  }\n": typeof types.ScanProgressDocument,
    "\n  mutation LibraryScan($userId: ID!) {\n    libraryScan(input: { userId: $userId }) {\n      __typename\n      ... on LibraryScanPayload {\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n      ... on ScanAlreadyRunningError {\n        message\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n": typeof types.LibraryScanDocument,
    "\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n": typeof types.ViewerBootstrapDocument,
};
const documents: Documents = {
    "\n  query DeviceList {\n    viewer {\n      devices {\n        id\n        name\n        slug\n        coverWidth\n        coverHeight\n        coverFit\n        bwCover\n        simplify\n      }\n    }\n  }\n": types.DeviceListDocument,
    "\n  mutation DeviceCreate($input: DeviceCreateInput!) {\n    deviceCreate(input: $input) {\n      __typename\n      ... on DeviceCreatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n": types.DeviceCreateDocument,
    "\n  mutation DeviceUpdate($input: DeviceUpdateInput!) {\n    deviceUpdate(input: $input) {\n      __typename\n      ... on DeviceUpdatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n": types.DeviceUpdateDocument,
    "\n  mutation DeviceDelete($input: DeviceDeleteInput!) {\n    deviceDelete(input: $input) {\n      __typename\n      ... on DeviceDeletePayload {\n        deletedDeviceId\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n": types.DeviceDeleteDocument,
    "\n  fragment ScanStatusFields on ScanStatus {\n    id\n    state\n    phase\n    processed\n    total\n    currentFile\n    startedAt\n    error\n    result {\n      imported {\n        id\n        title\n      }\n      # The string list the ScanResult tuple has always carried (REST parity).\n      # imported is [Book!]! and is NOT interchangeable with it.\n      importedFilenames\n      removed\n    }\n  }\n": types.ScanStatusFieldsFragmentDoc,
    "\n  query LibraryScanStatus($libraryId: ID!) {\n    node(id: $libraryId) {\n      id\n      ... on Library {\n        id\n        user {\n          id\n        }\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n": types.LibraryScanStatusDocument,
    "\n  subscription ScanProgress($libraryId: ID!) {\n    scanProgress(libraryId: $libraryId) {\n      ...ScanStatusFields\n    }\n  }\n": types.ScanProgressDocument,
    "\n  mutation LibraryScan($userId: ID!) {\n    libraryScan(input: { userId: $userId }) {\n      __typename\n      ... on LibraryScanPayload {\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n      ... on ScanAlreadyRunningError {\n        message\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n": types.LibraryScanDocument,
    "\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n": types.ViewerBootstrapDocument,
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
export function graphql(source: "\n  query DeviceList {\n    viewer {\n      devices {\n        id\n        name\n        slug\n        coverWidth\n        coverHeight\n        coverFit\n        bwCover\n        simplify\n      }\n    }\n  }\n"): (typeof documents)["\n  query DeviceList {\n    viewer {\n      devices {\n        id\n        name\n        slug\n        coverWidth\n        coverHeight\n        coverFit\n        bwCover\n        simplify\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeviceCreate($input: DeviceCreateInput!) {\n    deviceCreate(input: $input) {\n      __typename\n      ... on DeviceCreatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation DeviceCreate($input: DeviceCreateInput!) {\n    deviceCreate(input: $input) {\n      __typename\n      ... on DeviceCreatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeviceUpdate($input: DeviceUpdateInput!) {\n    deviceUpdate(input: $input) {\n      __typename\n      ... on DeviceUpdatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation DeviceUpdate($input: DeviceUpdateInput!) {\n    deviceUpdate(input: $input) {\n      __typename\n      ... on DeviceUpdatePayload {\n        device {\n          id\n          name\n          slug\n          coverWidth\n          coverHeight\n          coverFit\n          bwCover\n          simplify\n        }\n      }\n      ... on DeviceSlugConflictError {\n        message\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeviceDelete($input: DeviceDeleteInput!) {\n    deviceDelete(input: $input) {\n      __typename\n      ... on DeviceDeletePayload {\n        deletedDeviceId\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation DeviceDelete($input: DeviceDeleteInput!) {\n    deviceDelete(input: $input) {\n      __typename\n      ... on DeviceDeletePayload {\n        deletedDeviceId\n      }\n      ... on InvalidInputError {\n        message\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ScanStatusFields on ScanStatus {\n    id\n    state\n    phase\n    processed\n    total\n    currentFile\n    startedAt\n    error\n    result {\n      imported {\n        id\n        title\n      }\n      # The string list the ScanResult tuple has always carried (REST parity).\n      # imported is [Book!]! and is NOT interchangeable with it.\n      importedFilenames\n      removed\n    }\n  }\n"): (typeof documents)["\n  fragment ScanStatusFields on ScanStatus {\n    id\n    state\n    phase\n    processed\n    total\n    currentFile\n    startedAt\n    error\n    result {\n      imported {\n        id\n        title\n      }\n      # The string list the ScanResult tuple has always carried (REST parity).\n      # imported is [Book!]! and is NOT interchangeable with it.\n      importedFilenames\n      removed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query LibraryScanStatus($libraryId: ID!) {\n    node(id: $libraryId) {\n      id\n      ... on Library {\n        id\n        user {\n          id\n        }\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query LibraryScanStatus($libraryId: ID!) {\n    node(id: $libraryId) {\n      id\n      ... on Library {\n        id\n        user {\n          id\n        }\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription ScanProgress($libraryId: ID!) {\n    scanProgress(libraryId: $libraryId) {\n      ...ScanStatusFields\n    }\n  }\n"): (typeof documents)["\n  subscription ScanProgress($libraryId: ID!) {\n    scanProgress(libraryId: $libraryId) {\n      ...ScanStatusFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LibraryScan($userId: ID!) {\n    libraryScan(input: { userId: $userId }) {\n      __typename\n      ... on LibraryScanPayload {\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n      ... on ScanAlreadyRunningError {\n        message\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation LibraryScan($userId: ID!) {\n    libraryScan(input: { userId: $userId }) {\n      __typename\n      ... on LibraryScanPayload {\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n      ... on ScanAlreadyRunningError {\n        message\n        scanStatus {\n          ...ScanStatusFields\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  query ViewerBootstrap {\n    viewer {\n      username\n      isAdmin\n      mustChangePassword\n      user {\n        id\n      }\n      library {\n        id\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;