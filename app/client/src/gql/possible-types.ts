
      export interface PossibleTypesResultData {
        possibleTypes: {
          [key: string]: string[]
        }
      }
      const result: PossibleTypesResultData = {
  "possibleTypes": {
    "BookAnalyzeReplaceResult": [
      "BookAnalyzeReplacePayload",
      "InvalidInputError",
      "StagedUploadNotFoundError"
    ],
    "BookClearEditLineageResult": [
      "BookClearEditLineagePayload"
    ],
    "BookClearEditionsResult": [
      "BookClearEditionsPayload"
    ],
    "BookDeleteResult": [
      "BookDeletePayload"
    ],
    "BookLinkDocumentResult": [
      "BookLinkDocumentPayload",
      "DocumentAlreadyLinkedError",
      "DocumentIsBookError",
      "InvalidInputError",
      "SelfLinkError"
    ],
    "BookRegenChaptersResult": [
      "BookHashCollisionError",
      "BookNotValidatedError",
      "BookRegenChaptersPayload"
    ],
    "BookReplaceResult": [
      "BookHashCollisionError",
      "BookReplacePayload",
      "EpubValidationError",
      "InvalidInputError",
      "StagedUploadNotFoundError"
    ],
    "BookRequestCreateResult": [
      "BookRequestCreatePayload",
      "BookRequestLimitExceededError",
      "DuplicateBookRequestError",
      "InvalidInputError"
    ],
    "BookResolvePendingFixResult": [
      "BookHashCollisionError",
      "BookNotValidatedError",
      "BookResolvePendingFixPayload",
      "EpubValidationError"
    ],
    "BookUnlinkDocumentResult": [
      "BookUnlinkDocumentPayload",
      "EditLineageEntryError",
      "InvalidInputError",
      "LineageEntryNotFoundError"
    ],
    "BookUpdateMetadataResult": [
      "BookHashCollisionError",
      "BookNotValidatedError",
      "BookUpdateMetadataPayload",
      "EpubValidationError",
      "InvalidInputError",
      "StagedUploadNotFoundError"
    ],
    "BookValidateResult": [
      "BookValidatePayload"
    ],
    "DeviceCreateResult": [
      "DeviceCreatePayload",
      "DeviceSlugConflictError",
      "InvalidInputError"
    ],
    "DeviceDeleteResult": [
      "DeviceDeletePayload",
      "InvalidInputError"
    ],
    "DeviceDisableUserResult": [
      "DeviceDisableUserPayload",
      "InvalidInputError"
    ],
    "DeviceEnableUserResult": [
      "DeviceEnableUserPayload",
      "InvalidInputError"
    ],
    "DeviceUpdateResult": [
      "DeviceSlugConflictError",
      "DeviceUpdatePayload",
      "InvalidInputError"
    ],
    "LibraryEntry": [
      "Book",
      "Series"
    ],
    "LibraryScanResult": [
      "LibraryScanPayload",
      "ScanAlreadyRunningError"
    ],
    "Node": [
      "Book",
      "BookRequest",
      "Library",
      "Series",
      "User"
    ],
    "ProgressDeleteResult": [
      "ProgressDeletePayload"
    ],
    "ProgressSetResult": [
      "InvalidInputError",
      "ProgressSetPayload"
    ],
    "UserChangePasswordResult": [
      "IncorrectPasswordError",
      "InvalidInputError",
      "UserChangePasswordPayload"
    ],
    "UserDeleteResult": [
      "UserDeletePayload"
    ],
    "UserError": [
      "BookHashCollisionError",
      "BookNotValidatedError",
      "BookRequestLimitExceededError",
      "BookRequestNotPendingError",
      "DeviceSlugConflictError",
      "DocumentAlreadyLinkedError",
      "DocumentIsBookError",
      "DuplicateBookRequestError",
      "EditLineageEntryError",
      "EpubValidationError",
      "IncorrectPasswordError",
      "InvalidInputError",
      "LineageEntryNotFoundError",
      "ScanAlreadyRunningError",
      "SelfLinkError",
      "StagedUploadNotFoundError",
      "UsernameAlreadyExistsError"
    ],
    "UserRegenerateSyncPasswordResult": [
      "UserRegenerateSyncPasswordPayload"
    ],
    "UserRegisterResult": [
      "InvalidInputError",
      "UserRegisterPayload",
      "UsernameAlreadyExistsError"
    ],
    "UserResetPasswordResult": [
      "UserResetPasswordPayload"
    ]
  }
};
      export default result;
    