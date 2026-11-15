import cx from 'classnames';
import { useCallback, useState } from 'react';

import { Button, TextArea, TextInput } from '~/control';

import { CardDivider } from '../card-divider';
import { useStyle } from './style';

export type BookRequestFormValues = { title: string; author: string; note: string };

export type BookRequestFormProps = {
  /** When given, the form edits these values and offers Cancel; otherwise it is the create form and clears itself after a successful submit. */
  initial?: BookRequestFormValues;
  submitLabel: string;
  /** Receives TRIMMED values. Resolves to `undefined` on success, or the message to show under the fields. */
  onSubmit: (values: BookRequestFormValues) => Promise<string | undefined>;
  onCancel?: () => void;
};

/**
 * The title/author/note fields of a book request, shared by the create card
 * (`component/book-requests-content`) and a pending row's edit mode
 * (`component/book-request-row`) so the validation cannot drift between
 * them — the same one-form-for-create-and-edit shape `DeviceForm` uses.
 *
 * **Title and author are validated here** (non-empty after trimming), the
 * same rule the server's zod schemas apply, so an obviously-invalid request
 * never spends a round trip. `note` may be empty.
 *
 * **The network stays with the caller.** `onSubmit` gets trimmed values and
 * answers with the message to show, or `undefined` for success; this form
 * knows nothing about which mutation runs or what it refetches. On success
 * the create form (no `initial`) clears itself for the next request; the
 * edit form keeps its values, because its parent unmounts it.
 */
export const BookRequestForm = ({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: BookRequestFormProps) => {
  const styles = useStyle();

  const [title, setTitle] = useState<string>(initial?.title ?? '');
  const [author, setAuthor] = useState<string>(initial?.author ?? '');
  const [note, setNote] = useState<string>(initial?.note ?? '');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const handleTitleChange = useCallback(
    (newValue: string | undefined) => setTitle(newValue ?? ''),
    []
  );
  const handleAuthorChange = useCallback(
    (newValue: string | undefined) => setAuthor(newValue ?? ''),
    []
  );
  const handleNoteChange = useCallback(
    (newValue: string | undefined) => setNote(newValue ?? ''),
    []
  );

  const isEdit = initial !== undefined;

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(undefined);

      const trimmedTitle = title.trim();
      const trimmedAuthor = author.trim();
      const missing: string[] = [];
      if (trimmedTitle === '') missing.push('Title');
      if (trimmedAuthor === '') missing.push('Author');
      if (missing.length > 0) {
        setFormError(`${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} required`);
        return;
      }

      setSubmitting(true);
      try {
        const message = await onSubmit({
          title: trimmedTitle,
          author: trimmedAuthor,
          note: note.trim(),
        });
        if (message !== undefined) {
          setFormError(message);
          return;
        }
        if (!isEdit) {
          setTitle('');
          setAuthor('');
          setNote('');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [title, author, note, onSubmit, isEdit]
  );

  const submit = (
    <Button type="primary" radius="card" submit loading={submitting}>
      {submitLabel}
    </Button>
  );

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <TextInput name="title" label="Title" value={title} onChange={handleTitleChange} />
      <TextInput name="author" label="Author" value={author} onChange={handleAuthorChange} />
      <TextArea name="note" label="Note" value={note} onChange={handleNoteChange} />
      {formError && <div className={cx(styles.message, styles.error)}>{formError}</div>}
      <CardDivider />
      {onCancel ? (
        <div className={styles.actions}>
          <Button type="default" radius="card" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
          {submit}
        </div>
      ) : (
        submit
      )}
    </form>
  );
};
