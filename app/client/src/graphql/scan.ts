import { graphql } from '~/gql';

/**
 * Shared by the reconnect read and the live stream so both write the SAME
 * shape into the cache. `ScanStatus` carries a scalar `id`, so events merge
 * into an already-rendered `Library.scanStatus` with no typePolicy override.
 */
export const ScanStatusFieldsFragment = graphql(`
  fragment ScanStatusFields on ScanStatus {
    id
    state
    phase
    processed
    total
    currentFile
    startedAt
    error
    result {
      imported {
        id
        title
      }
      # The string list the ScanResult tuple has always carried (REST parity).
      # imported is [Book!]! and is NOT interchangeable with it.
      importedFilenames
      removed
    }
  }
`);

/**
 * The reconnect / current-state read. There is an inherent registration gap
 * between opening the stream and the server publishing to it, so this runs
 * immediately after subscribing and on every reconnect.
 *
 * `user { id }` is the bridge to the mutation: `libraryScan` is keyed on a USER
 * global ID while the subscription is keyed on a LIBRARY one. Reading it off
 * the current library makes the scan work identically for self and for an admin
 * viewing someone else's library.
 */
export const LibraryScanStatusDocument = graphql(`
  query LibraryScanStatus($libraryId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        user {
          id
        }
        scanStatus {
          ...ScanStatusFields
        }
      }
    }
  }
`);

export const ScanProgressDocument = graphql(`
  subscription ScanProgress($libraryId: ID!) {
    scanProgress(libraryId: $libraryId) {
      ...ScanStatusFields
    }
  }
`);

/**
 * `LibraryScanResult` is a two-member union. `ScanAlreadyRunningError` is NOT a
 * failure for this UI — it is the "attach to the running scan" path, the direct
 * equivalent of the REST route's HTTP 409, and it carries the live `scanStatus`.
 *
 * The whole result is nullable ("Resolves to null when the resolved owner does
 * not exist"), so the call site branches three ways: null / error member /
 * payload.
 */
export const LibraryScanDocument = graphql(`
  mutation LibraryScan($userId: ID!) {
    libraryScan(input: { userId: $userId }) {
      __typename
      ... on LibraryScanPayload {
        scanStatus {
          ...ScanStatusFields
        }
      }
      ... on ScanAlreadyRunningError {
        message
        scanStatus {
          ...ScanStatusFields
        }
      }
    }
  }
`);
