import { useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, ConfirmModal, ResetPasswordButton } from '~/control';
import { graphql, useFragment, type FragmentType } from '~/gql';
import type { UserDeleteMutation } from '~/gql/graphql';
import { UserDeleteDocument } from '~/graphql/user';
import { AlertOctagonIcon } from '~/icon';
import { unwrapResult } from '~/provider/apollo';

import { UserRowContent } from '../user-row-content';
import { useStyle } from './style';

/**
 * Colocated: this component declares exactly the fields it renders —
 * `page/user-list` composes it into `UserListDocument` (`~/graphql/user`,
 * imported there rather than declared there — this fragment stays
 * colocated on `UserRow` regardless of which module owns the document;
 * codegen resolves `...UserRowFragment` by NAME, not by JS import).
 * `progressCount` feeds the "N books synced" subtitle directly off the
 * fragment, so (unlike the deleted `useUser` hook this replaces) there is
 * no separate loading state to straddle: `UserRow` only ever mounts once
 * its own ref exists.
 *
 * **`Viewer.users` carries a ×50 cost multiplier** — every field selected
 * here rides that multiplier, so this selection is kept deliberately
 * narrow: `id` (the User global ID every user mutation addresses),
 * `username` (display + list keying), `progressCount` (this subtitle).
 * `library { id }` also rides along on `UserListDocument`'s entry, but
 * lives as a sibling field on the DOCUMENT (`~/graphql/user`), not in this
 * fragment — `UserRow` never renders it. **Do NOT add a field here**
 * without checking `test:cost -w app/server` first: `viewer.users →
 * library.progress` is this project's worst-measured legitimate query
 * shape at 68.5% of the complexity budget, and this fragment is exactly
 * where a future field would naturally be added — a single unbounded
 * child (e.g. anything under `library`) can push that shape over budget.
 */
export const UserRowFragment = graphql(`
  fragment UserRowFragment on User {
    id
    username
    progressCount
  }
`);

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserDeletePayload = Extract<
  NonNullable<UserDeleteMutation['userDelete']>,
  { __typename: 'UserDeletePayload' }
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
  const unmasked = useFragment(UserRowFragment, user);
  const [runDelete] = useMutation(UserDeleteDocument);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | undefined>();

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
            id: cache.identify({ __typename: 'User', id: result.payload.deletedId }),
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

  return (
    <Fragment>
      <Card
        isCollapsible
        defaultCollapsed
        title={unmasked.username}
        subTitle={`${unmasked.progressCount} book${unmasked.progressCount === 1 ? '' : 's'} synced`}
        headerAction={
          <Fragment>
            <ResetPasswordButton userId={unmasked.id} username={unmasked.username} />
            <Button type="link" danger onClick={handleDeleteUser} loading={deleting}>
              Delete user
            </Button>
          </Fragment>
        }
      >
        <div className={styles.content}>
          <UserRowContent userId={unmasked.id} username={unmasked.username} />
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
    </Fragment>
  );
};
