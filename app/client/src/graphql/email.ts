import { graphql } from '~/gql';

/**
 * Three mutations, one file: they are the whole email-setup flow
 * (`page/set-email`) and are always changed together. `__typename` is
 * selected on every union member so the page can branch on it through
 * `unwrapResult`. Error members are selected through the shared `UserError`
 * interface (`message` is its only field) rather than repeated per concrete
 * type — `ViewerSetEmailResult` alone has three (`EmailInUseError`,
 * `EmailNotConfiguredError`, `InvalidInputError`), and the page only ever
 * shows the plain message, never `InvalidInputError`'s per-field `issues`.
 */
export const ViewerSetEmailDocument = graphql(`
  mutation ViewerSetEmail($input: ViewerSetEmailInput!) {
    viewerSetEmail(input: $input) {
      __typename
      ... on ViewerSetEmailPayload {
        email
        delivered
      }
      ... on UserError {
        message
      }
    }
  }
`);

export const ViewerConfirmEmailDocument = graphql(`
  mutation ViewerConfirmEmail($input: ViewerConfirmEmailInput!) {
    viewerConfirmEmail(input: $input) {
      __typename
      ... on ViewerConfirmEmailPayload {
        email
      }
      ... on UserError {
        message
      }
    }
  }
`);

export const ViewerResendEmailVerificationDocument = graphql(`
  mutation ViewerResendEmailVerification {
    viewerResendEmailVerification {
      __typename
      ... on ViewerResendEmailVerificationPayload {
        delivered
      }
      ... on UserError {
        message
      }
    }
  }
`);
