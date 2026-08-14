import { useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import type { BookUnlinkDocumentMutation } from '~/gql/graphql';
import { BookUnlinkDocumentDocument } from '~/graphql/book';
import { AlertOctagonIcon } from '~/icon';
import { unwrapResult } from '~/provider/apollo';

import { Button, type ButtonTypeValue, ButtonRadiusValue } from '../button';
import { ConfirmModal } from '../confirm-modal';
import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type BookUnlinkDocumentPayload = Extract<
  NonNullable<BookUnlinkDocumentMutation['bookUnlinkDocument']>,
  { __typename: 'BookUnlinkDocumentPayload' }
>;

interface UnlinkBookLineageButtonProps {
  bookId: string;
  bookTitle: string;
  buttonType?: ButtonTypeValue;
  documentId: string;
  onSuccess?: () => void;
  buttonRadius?: ButtonRadiusValue;
}

/**
 * `bookTitle` is a plain prop now, not a `useBook` lookup — this was the
 * hook's only use here (rendering the book's title in the confirm text), and
 * `BookLineageModal`'s caller already has it (task 10). Retires this as a
 * `useBook` CONSUMER; `useBook` itself is untouched (other consumers remain).
 *
 * Calls `bookUnlinkDocument` directly via `useMutation` rather than through a
 * dedicated hook — this is the button's only mutation, and
 * `use-unlink-book-lineage.ts` (the REST-era hook) is deleted outright rather
 * than reshaped, per this task's brief.
 *
 * Unlike the REST-era version, the confirm modal stays OPEN on failure and
 * shows the server's own error message inline — it previously closed
 * immediately on confirm-click regardless of outcome, so a rejected unlink
 * (e.g. `EditLineageEntryError`) had nowhere to surface. It closes only after
 * a genuine `BookUnlinkDocumentPayload` success.
 */
export const UnlinkBookLineageButton = ({
  bookId,
  bookTitle,
  buttonType,
  documentId,
  onSuccess,
  buttonRadius,
}: UnlinkBookLineageButtonProps) => {
  const style = useStyle();

  const [runUnlink] = useMutation(BookUnlinkDocumentDocument);
  const [unlinking, setUnlinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [showUnlinkModal, setShowUnlinkModal] = useState<boolean>(false);

  const handleUnlink = useCallback(() => {
    setErrorMessage(undefined);
    setShowUnlinkModal(true);
  }, []);
  const handleUnlinkCancel = useCallback(() => {
    setShowUnlinkModal(false);
  }, []);
  const handleUnlinkConfirm = useCallback(async () => {
    if (unlinking) return;

    setUnlinking(true);
    setErrorMessage(undefined);
    try {
      const { data } = await runUnlink({ variables: { id: bookId, documentId } });
      const result = unwrapResult<BookUnlinkDocumentPayload>(
        data?.bookUnlinkDocument,
        'BookUnlinkDocumentPayload'
      );
      if (result.status === 'missing') {
        setErrorMessage('Failed to unlink document');
        return;
      }
      if (result.status === 'error') {
        setErrorMessage(result.message);
        return;
      }

      setShowUnlinkModal(false);
      onSuccess?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to unlink document');
    } finally {
      setUnlinking(false);
    }
  }, [bookId, documentId, runUnlink, unlinking, onSuccess]);

  return (
    <Fragment>
      <Button type={buttonType} onClick={handleUnlink} danger radius={buttonRadius}>
        unlink
      </Button>
      <ConfirmModal
        icon={AlertOctagonIcon}
        isOpen={showUnlinkModal}
        onCancel={handleUnlinkCancel}
        onConfirm={() => void handleUnlinkConfirm()}
        danger
        title={`Unlink document?`}
        confirmText="Unlink"
        loading={unlinking}
      >
        This action will unlink{' '}
        <span className={style.document}>
          {documentId.slice(0, 4)}…{documentId.slice(-4)}
        </span>{' '}
        from <span className={style.book}>{bookTitle}</span> leaving all progress behind.
        {errorMessage && <p className={style.error}>{errorMessage}</p>}
      </ConfirmModal>
    </Fragment>
  );
};
