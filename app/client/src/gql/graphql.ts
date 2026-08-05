/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type CoverFit =
  | 'CONTAIN'
  | 'COVER'
  | 'FILL'
  | 'SMART';

export type DeviceCreateInput = {
  bwCover: boolean;
  coverFit: CoverFit;
  coverHeight?: number | null | undefined;
  coverWidth?: number | null | undefined;
  name: string;
  simplify: boolean;
};

export type DeviceDeleteInput = {
  deviceId: string;
};

export type DeviceUpdateInput = {
  bwCover: boolean;
  coverFit: CoverFit;
  coverHeight?: number | null | undefined;
  coverWidth?: number | null | undefined;
  deviceId: string;
  name: string;
  simplify: boolean;
};

export type ScanPhase =
  | 'IMPORTING'
  | 'PRUNING';

export type ScanState =
  | 'COMPLETED'
  | 'FAILED'
  | 'RUNNING';

export type DeviceListQueryVariables = Exact<{ [key: string]: never; }>;


export type DeviceListQuery = { __typename: 'Query', viewer: { __typename: 'Viewer', devices: Array<{ __typename: 'Device', id: string, name: string, slug: string, coverWidth: number | null, coverHeight: number | null, coverFit: CoverFit, bwCover: boolean, simplify: boolean }> } };

export type DeviceCreateMutationVariables = Exact<{
  input: DeviceCreateInput;
}>;


export type DeviceCreateMutation = { __typename: 'Mutation', deviceCreate:
    | { __typename: 'DeviceCreatePayload', device: { __typename: 'Device', id: string, name: string, slug: string, coverWidth: number | null, coverHeight: number | null, coverFit: CoverFit, bwCover: boolean, simplify: boolean } }
    | { __typename: 'DeviceSlugConflictError', message: string }
    | { __typename: 'InvalidInputError', message: string }
   };

export type DeviceUpdateMutationVariables = Exact<{
  input: DeviceUpdateInput;
}>;


export type DeviceUpdateMutation = { __typename: 'Mutation', deviceUpdate:
    | { __typename: 'DeviceSlugConflictError', message: string }
    | { __typename: 'DeviceUpdatePayload', device: { __typename: 'Device', id: string, name: string, slug: string, coverWidth: number | null, coverHeight: number | null, coverFit: CoverFit, bwCover: boolean, simplify: boolean } }
    | { __typename: 'InvalidInputError', message: string }
   | null };

export type DeviceDeleteMutationVariables = Exact<{
  input: DeviceDeleteInput;
}>;


export type DeviceDeleteMutation = { __typename: 'Mutation', deviceDelete:
    | { __typename: 'DeviceDeletePayload', deletedDeviceId: string }
    | { __typename: 'InvalidInputError', message: string }
   | null };

export type ScanStatusFieldsFragment = { __typename: 'ScanStatus', id: string, state: ScanState, phase: ScanPhase, processed: number, total: number, currentFile: string | null, startedAt: string, error: string | null, result: { __typename: 'ScanResult', importedFilenames: Array<string>, removed: Array<string>, imported: Array<{ __typename: 'Book', id: string, title: string }> } | null } & { ' $fragmentName'?: 'ScanStatusFieldsFragment' };

export type LibraryScanStatusQueryVariables = Exact<{
  libraryId: string | number;
}>;


export type LibraryScanStatusQuery = { __typename: 'Query', node:
    | { __typename: 'Book', id: string }
    | { __typename: 'Library', id: string, user: { __typename: 'User', id: string }, scanStatus: (
        { __typename: 'ScanStatus' }
        & { ' $fragmentRefs'?: { 'ScanStatusFieldsFragment': ScanStatusFieldsFragment } }
      ) | null }
    | { __typename: 'Series', id: string }
    | { __typename: 'User', id: string }
   | null };

export type ScanProgressSubscriptionVariables = Exact<{
  libraryId: string | number;
}>;


export type ScanProgressSubscription = { scanProgress: (
    { __typename: 'ScanStatus' }
    & { ' $fragmentRefs'?: { 'ScanStatusFieldsFragment': ScanStatusFieldsFragment } }
  ) };

export type LibraryScanMutationVariables = Exact<{
  userId: string | number;
}>;


export type LibraryScanMutation = { __typename: 'Mutation', libraryScan:
    | { __typename: 'LibraryScanPayload', scanStatus: (
        { __typename: 'ScanStatus' }
        & { ' $fragmentRefs'?: { 'ScanStatusFieldsFragment': ScanStatusFieldsFragment } }
      ) }
    | { __typename: 'ScanAlreadyRunningError', message: string, scanStatus: (
        { __typename: 'ScanStatus' }
        & { ' $fragmentRefs'?: { 'ScanStatusFieldsFragment': ScanStatusFieldsFragment } }
      ) }
   | null };

export type ViewerBootstrapQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerBootstrapQuery = { __typename: 'Query', viewer: { __typename: 'Viewer', username: string, isAdmin: boolean, mustChangePassword: boolean, user: { __typename: 'User', id: string } | null, library: { __typename: 'Library', id: string } | null } };

export const ScanStatusFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<ScanStatusFieldsFragment, unknown>;
export const DeviceListDocument = {"__meta__":{"hash":"sha256:c471b2f65e505ff3ced362abb27cb0f0a5e295f2a22cb2f30f0964ada2378aec"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeviceList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"devices"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"coverWidth"}},{"kind":"Field","name":{"kind":"Name","value":"coverHeight"}},{"kind":"Field","name":{"kind":"Name","value":"coverFit"}},{"kind":"Field","name":{"kind":"Name","value":"bwCover"}},{"kind":"Field","name":{"kind":"Name","value":"simplify"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceListQuery, DeviceListQueryVariables>;
export const DeviceCreateDocument = {"__meta__":{"hash":"sha256:d0c91fe97ea1cd102223c619c265bd2e4ec08da4e1ca0518762b9746471f90d3"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceCreate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceCreateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceCreate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceCreatePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"coverWidth"}},{"kind":"Field","name":{"kind":"Name","value":"coverHeight"}},{"kind":"Field","name":{"kind":"Name","value":"coverFit"}},{"kind":"Field","name":{"kind":"Name","value":"bwCover"}},{"kind":"Field","name":{"kind":"Name","value":"simplify"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceSlugConflictError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceCreateMutation, DeviceCreateMutationVariables>;
export const DeviceUpdateDocument = {"__meta__":{"hash":"sha256:4b991ad7fd22b6ea5b1588f5e660acc2d8c02c09d63552d4afbb07380da951ab"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceUpdateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceUpdatePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"coverWidth"}},{"kind":"Field","name":{"kind":"Name","value":"coverHeight"}},{"kind":"Field","name":{"kind":"Name","value":"coverFit"}},{"kind":"Field","name":{"kind":"Name","value":"bwCover"}},{"kind":"Field","name":{"kind":"Name","value":"simplify"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceSlugConflictError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceUpdateMutation, DeviceUpdateMutationVariables>;
export const DeviceDeleteDocument = {"__meta__":{"hash":"sha256:a5780f68dcf03ef20d7cb7df7b131cc2c31563cc691e8f3730dcec80fd734546"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceDelete"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceDeleteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceDelete"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceDeletePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deletedDeviceId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceDeleteMutation, DeviceDeleteMutationVariables>;
export const LibraryScanStatusDocument = {"__meta__":{"hash":"sha256:d79fa838da3416e21f25dcbb99f3c60dee5420f349e366e979cda6f18dfc2190"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LibraryScanStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"scanStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<LibraryScanStatusQuery, LibraryScanStatusQueryVariables>;
export const ScanProgressDocument = {"__meta__":{"hash":"sha256:a7b7efface5858b50fcccad714ab3deed2ae62da55cd3d3f914c48814ae36acb"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ScanProgress"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scanProgress"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"libraryId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<ScanProgressSubscription, ScanProgressSubscriptionVariables>;
export const LibraryScanDocument = {"__meta__":{"hash":"sha256:fccb16a129bfe3e875d60683d4b1fab1c9f7e23ad88fea9af70c155d7d111776"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LibraryScan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"libraryScan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryScanPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"scanStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanAlreadyRunningError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"scanStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<LibraryScanMutation, LibraryScanMutationVariables>;
export const ViewerBootstrapDocument = {"__meta__":{"hash":"sha256:8c438916bdd1980a46caef439e1ba70b4ddad1fa4134c647b012178854aef7d5"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ViewerBootstrap"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"isAdmin"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<ViewerBootstrapQuery, ViewerBootstrapQueryVariables>;