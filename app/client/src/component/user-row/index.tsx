import { useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component/card';
import { Button, ConfirmModal, ResetPasswordButton } from '~/control';
import { graphql, useFragment, type FragmentType } from '~/gql';
import type { UserClearEmailMutation, UserDeleteMutation } from '~/gql/graphql';
import { UserClearEmailDocument, UserDeleteDocument } from '~/graphql/user';
import { AlertOctagonIcon } from '~/icon';
import { unwrapResult } from '~/provider/apollo';
import { useEmailEnabled } from '~/provider/config';

import { UserRowContent } from '../user-row-content';
import { useStyle } from './style';

/**
 * Colocated: this component declares exactly the fields it renders —
 * `page/user-list` composes it into `UserListDocument` (`~/graphql/user`,
 * imported there rather than declared there — this fragment stays
 * colocated on `UserRow` regardless of which module owns the document;
 * codegen resolves `...UserRowFragment` by NAME, not by JS import).
 * The row reads everything it renders straight off this fragment, so (unlike
 * the deleted `useUser` hook this replaces) there is no separate loading state
 * to straddle: `UserRow` only ever mounts once its own ref exists.
 *
 * **`Viewer.users` carries a ×50 cost multiplier** — every field selected
 * here rides that multiplier, so this selection is kept deliberately
 * narrow: `id` (the User global ID every user mutation addresses),
 * `username` (display + list keying), and `pendingBookRequestCount` — which
 * this row does NOT render: it is read by `component/library-switcher` (a
 * per-option count) and `component/nav` (the Add tab's dot), both of which
 * unmask this same fragment off `UserListDocument`. `library { id }` also
 * rides along on `UserListDocument`'s entry, but lives as a sibling field on
 * the DOCUMENT (`~/graphql/user`), not in this fragment — `UserRow` never
 * renders it. **Do NOT add a field here** without checking `test:cost -w
 * app/server` first: `viewer.users → library.progress` is this project's
 * worst-measured legitimate query shape at 68.8% of the complexity budget,
 * and this fragment is exactly where a future field would naturally be
 * added — a single unbounded child (e.g. anything under `library`) can push
 * that shape over budget. `pendingBookRequestCount` itself is a scalar
 * `t.relationCount` (`app/server/graphql/schema/user/model.ts`), not an
 * unbounded child, so it adds only breadth/complexity proportional to a
 * plain field under the ×50 multiplier — measured before/after in this
 * task's commit message.
 *
 * `email`/`emailVerifiedAt` (email-address-ownership work, task 3) are the
 * same shape as `pendingBookRequestCount`: two more plain scalars, not
 * unbounded children, so their cost rides the ×50 multiplier proportionally
 * rather than compounding it — also measured before/after in this task's
 * commit message. They are what lets the operator answer "who holds this
 * address?" from the list itself, and what `userClearEmail` (below) needs
 * to know it has something to clear.
 */
export const UserRowFragment = graphql(`
  fragment UserRowFragment on User {
    id
    username
    pendingBookRequestCount
    email
    emailVerifiedAt
  }
`);

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserDeletePayload = Extract<
  NonNullable<UserDeleteMutation['userDelete']>,
  { __typename: 'UserDeletePayload' }
>;

// Same reasoning as `UserDeletePayload` above.
type UserClearEmailPayload = Extract<
  NonNullable<UserClearEmailMutation['userClearEmail']>,
  { __typename: 'UserClearEmailPayload' }
>;

interface UserRowProps {
  user: FragmentType<typeof UserRowFragment>;
}

/**
 * `useFragment` is called exactly once, unconditionally, at the top of this
 * component's own body — mirroring `component/device-row`.
 *
 * Delete is a direct `useMutation(UserDeleteDocument)` call here rather than
 * a dedicated hook: this row is its only caller. No `optimisticResponse`
 * (unlike `DeviceRow`'s delete): `userDelete` has none, so `update` runs
 * once, against the real response — `viewer.users` is an array of
 * references, which Apollo auto-filters once the referenced `User` entity is
 * evicted, so a plain `cache.evict` is enough (no `cache.modify` list filter
 * needed alongside it, unlike `DeviceRow`'s optimistic delete).
 */
export const UserRow = ({ user }: UserRowProps) => {
  const styles = useStyle();
  const emailEnabled = useEmailEnabled();
  const unmasked = useFragment(UserRowFragment, user);
  const [runDelete] = useMutation(UserDeleteDocument);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | undefined>();

  // No local override for `email`/`emailVerifiedAt`: `UserClearEmailDocument`
  // selects `user { id email emailVerifiedAt }`, which normalizes
  // `User:<id>` in Apollo's cache in place, and every real mount of this row
  // (`page/user-list` -> `component/user-list`) sits under an ACTIVE
  // `useQuery(UserListDocument)` that watches that same entity — the cache
  // write alone re-broadcasts fresh props down to this row in the same
  // tick, no override needed. An override would additionally be a hazard,
  // not just redundant: it would freeze at `null` for this row's whole
  // mounted lifetime, hiding a LATER address the user sets for themselves
  // (e.g. a background refetch landing after the clear) until the row
  // unmounts. `isConfirmed` reads straight off the fragment.
  const isConfirmed = unmasked.emailVerifiedAt !== null;

  const [showDeleteUserModal, setShowDeleteUserModal] = useState<boolean>(false);
  const handleDeleteUser = useCallback(() => {
    setDeleteErrorMessage(undefined);
    setShowDeleteUserModal(true);
  }, []);
  const handleDeleteUserCancel = useCallback(() => {
    setShowDeleteUserModal(false);
  }, []);
  // Mirrors `DeviceRow`'s own shape: the modal stays OPEN and shows the
  // server's own message inline on failure, closing only after a genuine
  // `UserDeletePayload` success.
  const handleDeleteUserConfirm = useCallback(async () => {
    const userId = unmasked.id;
    setDeleting(true);
    setDeleteErrorMessage(undefined);
    try {
      const { data } = await runDelete({
        variables: { input: { userId } },
        update: (cache, { data: mutationData }) => {
          const result = unwrapResult<UserDeletePayload>(
            mutationData?.userDelete,
            'UserDeletePayload'
          );
          if (result.status !== 'ok') return;

          cache.evict({
            id: cache.identify({
              __typename: 'User',
              id: result.payload.deletedId,
            }),
          });
        },
      });

      const result = unwrapResult<UserDeletePayload>(data?.userDelete, 'UserDeletePayload');
      if (result.status === 'missing') {
        setDeleteErrorMessage('Failed to delete user');
        return;
      }
      if (result.status === 'error') {
        setDeleteErrorMessage(result.message);
        return;
      }

      setShowDeleteUserModal(false);
    } catch (err) {
      setDeleteErrorMessage(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  }, [runDelete, unmasked.id]);

  const [runClearEmail] = useMutation(UserClearEmailDocument);
  const [clearing, setClearing] = useState<boolean>(false);
  const [clearEmailErrorMessage, setClearEmailErrorMessage] = useState<string | undefined>();

  const [showClearEmailModal, setShowClearEmailModal] = useState<boolean>(false);
  const handleClearEmail = useCallback(() => {
    setClearEmailErrorMessage(undefined);
    setShowClearEmailModal(true);
  }, []);
  const handleClearEmailCancel = useCallback(() => {
    setShowClearEmailModal(false);
  }, []);
  // Same shape as `handleDeleteUserConfirm` above: the modal stays OPEN and
  // shows a message inline on failure, closing only after a genuine
  // `UserClearEmailPayload`. Unlike delete, the mutation FIELD itself is
  // also nullable — it resolves to a bare `null` both when the user is gone
  // and when the target is the (indistinguishable) config-admin row. That
  // is not a typed error the server described, so it is not rendered as
  // one, but it is also not success: `unwrapResult`'s 'missing' status
  // covers exactly this, the same way it does for `UserDeleteDocument`
  // above.
  const handleClearEmailConfirm = useCallback(async () => {
    const userId = unmasked.id;
    setClearing(true);
    setClearEmailErrorMessage(undefined);
    try {
      const { data } = await runClearEmail({ variables: { input: { userId } } });

      const result = unwrapResult<UserClearEmailPayload>(
        data?.userClearEmail,
        'UserClearEmailPayload'
      );
      if (result.status === 'missing') {
        setClearEmailErrorMessage("Could not clear this user's address");
        return;
      }
      if (result.status === 'error') {
        setClearEmailErrorMessage(result.message);
        return;
      }

      // No cache write here beyond what Apollo already does with the
      // response: `UserClearEmailDocument` selects `user { id email
      // emailVerifiedAt }`, which normalizes `User:<id>` in place, and this
      // row's own `unmasked.email`/`unmasked.emailVerifiedAt` read straight
      // off that entity through whichever query is watching it.
      setShowClearEmailModal(false);
    } catch (err) {
      setClearEmailErrorMessage(
        err instanceof Error ? err.message : "Could not clear this user's address"
      );
    } finally {
      setClearing(false);
    }
  }, [runClearEmail, unmasked.id]);

  return (
    <Fragment>
      <Card
        isCollapsible
        defaultCollapsed
        title={
          <div className={styles.titleRow}>
            <span>{unmasked.username}</span>
            {unmasked.email !== null && (
              <span className={styles.addressPill}>
                <span className={styles.address}>{unmasked.email}</span>
                <span className={isConfirmed ? styles.badgeConfirmed : styles.badgeUnconfirmed}>
                  {isConfirmed ? 'Confirmed' : 'Not confirmed'}
                </span>
              </span>
            )}
          </div>
        }
        headerAction={
          <Fragment>
            <ResetPasswordButton userId={unmasked.id} username={unmasked.username} />
            {unmasked.email !== null && (
              <Button type="link" onClick={handleClearEmail} loading={clearing}>
                Clear address
              </Button>
            )}
            <Button type="link" danger onClick={handleDeleteUser} loading={deleting}>
              Delete user
            </Button>
          </Fragment>
        }
      >
        <div className={styles.content}>
          <UserRowContent userId={unmasked.id} username={unmasked.username} skip={false} />
        </div>
      </Card>
      <ConfirmModal
        isOpen={showDeleteUserModal}
        onCancel={handleDeleteUserCancel}
        onConfirm={() => void handleDeleteUserConfirm()}
        icon={AlertOctagonIcon}
        danger
        title="Delete user permanently?"
        confirmText="Delete"
        loading={deleting}
      >
        This action will delete <span className={styles.username}>{unmasked.username}</span>, all
        their reading progress, and <span className={styles.undone}>can not be undone</span>.
        {deleteErrorMessage && <p className={styles.error}>{deleteErrorMessage}</p>}
      </ConfirmModal>
      <ConfirmModal
        isOpen={showClearEmailModal}
        onCancel={handleClearEmailCancel}
        onConfirm={() => void handleClearEmailConfirm()}
        icon={AlertOctagonIcon}
        danger
        title="Clear this address?"
        confirmText="Clear"
        loading={clearing}
      >
        This will free <span className={styles.username}>{unmasked.username}</span>&apos;s address
        for another account to claim.
        {emailEnabled &&
          ' They will be asked to set an address again the next time their session refreshes.'}
        {clearEmailErrorMessage && <p className={styles.error}>{clearEmailErrorMessage}</p>}
      </ConfirmModal>
    </Fragment>
  );
};
