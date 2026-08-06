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

export type DeviceDisableUserInput = {
  deviceId: string;
  userId: string | number;
};

export type DeviceEnableUserInput = {
  deviceId: string;
  userId: string | number;
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

export type LibraryEntryStatus =
  | 'COMPLETED'
  | 'IN_PROGRESS'
  | 'NOT_STARTED';

export type LibraryEntryType =
  | 'SERIES'
  | 'STANDALONE';

export type LibraryFilter = {
  author?: string | null | undefined;
  entryType?: LibraryEntryType | null | undefined;
  query?: string | null | undefined;
  seriesName?: string | null | undefined;
  status?: LibraryEntryStatus | null | undefined;
  subjects?: Array<string> | null | undefined;
};

export type ScanPhase =
  | 'IMPORTING'
  | 'PRUNING';

export type ScanState =
  | 'COMPLETED'
  | 'FAILED'
  | 'RUNNING';

export type UserChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export type UserDeleteInput = {
  userId: string | number;
};

export type UserRegenerateSyncPasswordInput = {
  userId: string | number;
};

export type UserRegisterInput = {
  username: string;
};

export type UserResetPasswordInput = {
  userId: string | number;
};

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

export type DeviceUsersQueryVariables = Exact<{ [key: string]: never; }>;


export type DeviceUsersQuery = { __typename: 'Query', viewer: { __typename: 'Viewer', devices: Array<{ __typename: 'Device', id: string, enabledUsers: Array<{ __typename: 'User', id: string }> | null }> } };

export type DeviceEnableUserMutationVariables = Exact<{
  input: DeviceEnableUserInput;
}>;


export type DeviceEnableUserMutation = { __typename: 'Mutation', deviceEnableUser:
    | { __typename: 'DeviceEnableUserPayload', device: { __typename: 'Device', id: string, enabledUsers: Array<{ __typename: 'User', id: string }> | null } }
    | { __typename: 'InvalidInputError', message: string }
   | null };

export type DeviceDisableUserMutationVariables = Exact<{
  input: DeviceDisableUserInput;
}>;


export type DeviceDisableUserMutation = { __typename: 'Mutation', deviceDisableUser:
    | { __typename: 'DeviceDisableUserPayload', device: { __typename: 'Device', id: string, enabledUsers: Array<{ __typename: 'User', id: string }> | null } }
    | { __typename: 'InvalidInputError', message: string }
   | null };

export type BookRowFragmentFragment = { __typename: 'Book', id: string, title: string, author: string, seriesIndex: number, hasCover: boolean, thumbnailUrl: string, progress: { __typename: 'Progress', id: string, percentage: number } | null } & { ' $fragmentName'?: 'BookRowFragmentFragment' };

export type SeriesRowFragmentFragment = { __typename: 'Series', id: string, name: string, author: string, bookCount: number } & { ' $fragmentName'?: 'SeriesRowFragmentFragment' };

export type LibraryEntriesQueryVariables = Exact<{
  libraryId: string | number;
  first: number;
  after?: string | null | undefined;
  filter?: LibraryFilter | null | undefined;
}>;


export type LibraryEntriesQuery = { __typename: 'Query', node:
    | { __typename: 'Book', id: string }
    | { __typename: 'Library', id: string, entries: { __typename: 'LibraryEntriesConnection', edges: Array<{ __typename: 'LibraryEntriesConnectionEdge', cursor: string, node:
            | (
              { __typename: 'Book' }
              & { ' $fragmentRefs'?: { 'BookRowFragmentFragment': BookRowFragmentFragment } }
            )
            | (
              { __typename: 'Series' }
              & { ' $fragmentRefs'?: { 'SeriesRowFragmentFragment': SeriesRowFragmentFragment } }
            )
           }>, pageInfo: { __typename: 'PageInfo', hasNextPage: boolean, endCursor: string | null } } }
    | { __typename: 'Series', id: string }
    | { __typename: 'User', id: string }
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

export type UserListQueryVariables = Exact<{ [key: string]: never; }>;


export type UserListQuery = { __typename: 'Query', viewer: { __typename: 'Viewer', users: Array<{ __typename: 'User', id: string, username: string, progressCount: number }> | null } };

export type UserRegisterMutationVariables = Exact<{
  input: UserRegisterInput;
}>;


export type UserRegisterMutation = { __typename: 'Mutation', userRegister:
    | { __typename: 'InvalidInputError', message: string }
    | { __typename: 'UserRegisterPayload', password: string, user: { __typename: 'User', id: string, username: string, progressCount: number } }
    | { __typename: 'UsernameAlreadyExistsError', message: string }
   };

export type UserDeleteMutationVariables = Exact<{
  input: UserDeleteInput;
}>;


export type UserDeleteMutation = { __typename: 'Mutation', userDelete: { __typename: 'UserDeletePayload', deletedId: string } | null };

export type UserResetPasswordMutationVariables = Exact<{
  input: UserResetPasswordInput;
}>;


export type UserResetPasswordMutation = { __typename: 'Mutation', userResetPassword: { __typename: 'UserResetPasswordPayload', password: string, user: { __typename: 'User', id: string } } | null };

export type SyncPasswordQueryVariables = Exact<{ [key: string]: never; }>;


export type SyncPasswordQuery = { __typename: 'Query', viewer: { __typename: 'Viewer', syncPassword: string | null } };

export type UserRegenerateSyncPasswordMutationVariables = Exact<{
  input: UserRegenerateSyncPasswordInput;
}>;


export type UserRegenerateSyncPasswordMutation = { __typename: 'Mutation', userRegenerateSyncPassword: { __typename: 'UserRegenerateSyncPasswordPayload', syncPassword: string, user: { __typename: 'User', id: string } } | null };

export type UserChangePasswordMutationVariables = Exact<{
  input: UserChangePasswordInput;
}>;


export type UserChangePasswordMutation = { __typename: 'Mutation', userChangePassword:
    | { __typename: 'IncorrectPasswordError', message: string }
    | { __typename: 'InvalidInputError', message: string }
    | { __typename: 'UserChangePasswordPayload', user: { __typename: 'User', id: string } }
   | null };

export type ViewerBootstrapQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerBootstrapQuery = { __typename: 'Query', viewer: { __typename: 'Viewer', username: string, isAdmin: boolean, mustChangePassword: boolean, user: { __typename: 'User', id: string } | null, library: { __typename: 'Library', id: string } | null } };

export const BookRowFragmentFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BookRowFragment"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Book"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"seriesIndex"}},{"kind":"Field","name":{"kind":"Name","value":"hasCover"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnailUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"width"},"value":{"kind":"IntValue","value":"88"}}]},{"kind":"Field","name":{"kind":"Name","value":"progress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"percentage"}}]}}]}}]} as unknown as DocumentNode<BookRowFragmentFragment, unknown>;
export const SeriesRowFragmentFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesRowFragment"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"bookCount"}}]}}]} as unknown as DocumentNode<SeriesRowFragmentFragment, unknown>;
export const ScanStatusFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<ScanStatusFieldsFragment, unknown>;
export const DeviceListDocument = {"__meta__":{"hash":"sha256:c471b2f65e505ff3ced362abb27cb0f0a5e295f2a22cb2f30f0964ada2378aec"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeviceList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"devices"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"coverWidth"}},{"kind":"Field","name":{"kind":"Name","value":"coverHeight"}},{"kind":"Field","name":{"kind":"Name","value":"coverFit"}},{"kind":"Field","name":{"kind":"Name","value":"bwCover"}},{"kind":"Field","name":{"kind":"Name","value":"simplify"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceListQuery, DeviceListQueryVariables>;
export const DeviceCreateDocument = {"__meta__":{"hash":"sha256:d0c91fe97ea1cd102223c619c265bd2e4ec08da4e1ca0518762b9746471f90d3"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceCreate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceCreateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceCreate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceCreatePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"coverWidth"}},{"kind":"Field","name":{"kind":"Name","value":"coverHeight"}},{"kind":"Field","name":{"kind":"Name","value":"coverFit"}},{"kind":"Field","name":{"kind":"Name","value":"bwCover"}},{"kind":"Field","name":{"kind":"Name","value":"simplify"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceSlugConflictError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceCreateMutation, DeviceCreateMutationVariables>;
export const DeviceUpdateDocument = {"__meta__":{"hash":"sha256:4b991ad7fd22b6ea5b1588f5e660acc2d8c02c09d63552d4afbb07380da951ab"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceUpdate"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceUpdateInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceUpdate"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceUpdatePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"coverWidth"}},{"kind":"Field","name":{"kind":"Name","value":"coverHeight"}},{"kind":"Field","name":{"kind":"Name","value":"coverFit"}},{"kind":"Field","name":{"kind":"Name","value":"bwCover"}},{"kind":"Field","name":{"kind":"Name","value":"simplify"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceSlugConflictError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceUpdateMutation, DeviceUpdateMutationVariables>;
export const DeviceDeleteDocument = {"__meta__":{"hash":"sha256:a5780f68dcf03ef20d7cb7df7b131cc2c31563cc691e8f3730dcec80fd734546"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceDelete"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceDeleteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceDelete"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceDeletePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deletedDeviceId"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceDeleteMutation, DeviceDeleteMutationVariables>;
export const DeviceUsersDocument = {"__meta__":{"hash":"sha256:a5ee77ec8697f91ff3c4d7284d2fd86dfcd4587ddca33a9f3be59b35ebbbfe10"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DeviceUsers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"devices"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"enabledUsers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]}}]} as unknown as DocumentNode<DeviceUsersQuery, DeviceUsersQueryVariables>;
export const DeviceEnableUserDocument = {"__meta__":{"hash":"sha256:54abd5ccbd65f7b574bc6322c46b64a2e99923cabd2661cd2cf00510af858e28"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceEnableUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceEnableUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceEnableUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceEnableUserPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"enabledUsers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceEnableUserMutation, DeviceEnableUserMutationVariables>;
export const DeviceDisableUserDocument = {"__meta__":{"hash":"sha256:edcff27a54af95d78f1b9f8c3486ab4c90c80cc7686cb3dca0ce25dc1dbc9918"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeviceDisableUser"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceDisableUserInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deviceDisableUser"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"DeviceDisableUserPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"enabledUsers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<DeviceDisableUserMutation, DeviceDisableUserMutationVariables>;
export const LibraryEntriesDocument = {"__meta__":{"hash":"sha256:fc4cbaeb124cb54494a5cde587561c3f3137d21d0efc00426d8a2086dfa7e5e8"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LibraryEntries"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryFilter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"entries"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}},{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Book"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"BookRowFragment"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"SeriesRowFragment"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"endCursor"}}]}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"BookRowFragment"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Book"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"seriesIndex"}},{"kind":"Field","name":{"kind":"Name","value":"hasCover"}},{"kind":"Field","name":{"kind":"Name","value":"thumbnailUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"width"},"value":{"kind":"IntValue","value":"88"}}]},{"kind":"Field","name":{"kind":"Name","value":"progress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"percentage"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SeriesRowFragment"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"author"}},{"kind":"Field","name":{"kind":"Name","value":"bookCount"}}]}}]} as unknown as DocumentNode<LibraryEntriesQuery, LibraryEntriesQueryVariables>;
export const LibraryScanStatusDocument = {"__meta__":{"hash":"sha256:d79fa838da3416e21f25dcbb99f3c60dee5420f349e366e979cda6f18dfc2190"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LibraryScanStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Library"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"scanStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<LibraryScanStatusQuery, LibraryScanStatusQueryVariables>;
export const ScanProgressDocument = {"__meta__":{"hash":"sha256:a7b7efface5858b50fcccad714ab3deed2ae62da55cd3d3f914c48814ae36acb"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"ScanProgress"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scanProgress"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"libraryId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"libraryId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<ScanProgressSubscription, ScanProgressSubscriptionVariables>;
export const LibraryScanDocument = {"__meta__":{"hash":"sha256:fccb16a129bfe3e875d60683d4b1fab1c9f7e23ad88fea9af70c155d7d111776"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"LibraryScan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"userId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"libraryScan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"userId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"userId"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"LibraryScanPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"scanStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanAlreadyRunningError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"scanStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"ScanStatusFields"}}]}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"ScanStatusFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"ScanStatus"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"phase"}},{"kind":"Field","name":{"kind":"Name","value":"processed"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"currentFile"}},{"kind":"Field","name":{"kind":"Name","value":"startedAt"}},{"kind":"Field","name":{"kind":"Name","value":"error"}},{"kind":"Field","name":{"kind":"Name","value":"result"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"imported"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"importedFilenames"}},{"kind":"Field","name":{"kind":"Name","value":"removed"}}]}}]}}]} as unknown as DocumentNode<LibraryScanMutation, LibraryScanMutationVariables>;
export const UserListDocument = {"__meta__":{"hash":"sha256:5c9709f95d2d39bc22a20c4cdb615475f31f4d348e6a7df62d769af66dc8787c"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"UserList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"progressCount"}}]}}]}}]}}]} as unknown as DocumentNode<UserListQuery, UserListQueryVariables>;
export const UserRegisterDocument = {"__meta__":{"hash":"sha256:b5997c5aebaaa933b6d5d4700fa7c3e4ce0bcadc71b775b4001ab065ee584177"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UserRegister"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserRegisterInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"userRegister"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserRegisterPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"progressCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"password"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UsernameAlreadyExistsError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<UserRegisterMutation, UserRegisterMutationVariables>;
export const UserDeleteDocument = {"__meta__":{"hash":"sha256:28c31643332c1be26f6eba8ee356b32834ff06581e4c60367f11918899528d44"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UserDelete"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserDeleteInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"userDelete"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserDeletePayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deletedId"}}]}}]}}]}}]} as unknown as DocumentNode<UserDeleteMutation, UserDeleteMutationVariables>;
export const UserResetPasswordDocument = {"__meta__":{"hash":"sha256:89758fe430dc1e5598ca424c24298df58dca2a2529eea7c677b7d3d2cb1f943c"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UserResetPassword"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserResetPasswordInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"userResetPassword"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserResetPasswordPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"password"}}]}}]}}]}}]} as unknown as DocumentNode<UserResetPasswordMutation, UserResetPasswordMutationVariables>;
export const SyncPasswordDocument = {"__meta__":{"hash":"sha256:68b9971bd07724ae8b9700529a78109d2e54ce603f6ac3c27e729dec7c9dbde6"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SyncPassword"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"syncPassword"}}]}}]}}]} as unknown as DocumentNode<SyncPasswordQuery, SyncPasswordQueryVariables>;
export const UserRegenerateSyncPasswordDocument = {"__meta__":{"hash":"sha256:69f77058950b0f0d2971080a52ca757bb4de982a70245e9d7b5b52710909b13b"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UserRegenerateSyncPassword"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserRegenerateSyncPasswordInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"userRegenerateSyncPassword"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserRegenerateSyncPasswordPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"syncPassword"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]}}]} as unknown as DocumentNode<UserRegenerateSyncPasswordMutation, UserRegenerateSyncPasswordMutationVariables>;
export const UserChangePasswordDocument = {"__meta__":{"hash":"sha256:4e14d9b11a1919e3a6da825292ea1839236f25c533a7e44f9cd7f12cc1032555"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UserChangePassword"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UserChangePasswordInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"userChangePassword"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"UserChangePasswordPayload"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"InvalidInputError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"IncorrectPasswordError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]} as unknown as DocumentNode<UserChangePasswordMutation, UserChangePasswordMutationVariables>;
export const ViewerBootstrapDocument = {"__meta__":{"hash":"sha256:8c438916bdd1980a46caef439e1ba70b4ddad1fa4134c647b012178854aef7d5"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ViewerBootstrap"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"viewer"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"username"}},{"kind":"Field","name":{"kind":"Name","value":"isAdmin"}},{"kind":"Field","name":{"kind":"Name","value":"mustChangePassword"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"library"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<ViewerBootstrapQuery, ViewerBootstrapQueryVariables>;