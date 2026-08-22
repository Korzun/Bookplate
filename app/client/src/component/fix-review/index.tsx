import { Fragment, useState } from 'react';
import { Link } from 'react-router';

import { Button } from '~/control';
import { CheckIcon } from '~/icon';
import type { MetadataFix, UndoSnapshot } from '~/provider/book';
import { path } from '~/router';

import { CardDivider } from '../card-divider';
import { Tag } from '../tag';
import { useStyle } from './style';

interface Props {
  autoFixes: MetadataFix[];
  appliedFixes: MetadataFix[];
  proposals: MetadataFix[];
  onApplyFix: (fix: MetadataFix) => void;
  onApplyAll: () => void | Promise<void>;
  onDismissFix: (fix: MetadataFix) => void;
  onDismissAll: () => void | Promise<void>;
  onUndo?: () => void | Promise<void>;
  undo?: UndoSnapshot;
  /** When true, every accept/reject affordance is disabled — used while a
   * page-level "Accept all" is applying across the whole queue, so a
   * per-card decision can't race the in-flight sweep. */
  disabled?: boolean;
  /** Relay global id for the book this row's proposals belong to, used ONLY
   * to build the Edit link's `path.bookEdit(...)` href — `page/book-edit`
   * queries `Library.book(id:)`, which requires a Relay global id, not the
   * raw content hash the upload queue otherwise keys everything by (Task 7,
   * book-edit spec — this prop was named `bookId` and fed the raw hash
   * until then, which broke the Edit link the moment `page/book-edit`
   * moved off REST). Callers must resolve one before rendering this, never
   * derive it here — the client never encodes or decodes a Relay global id. */
  bookGlobalId?: string;
  /** Whether a to===null (flag-only) proposal offers an Edit link to the book
   * page. Defaults to true; only takes effect when `bookGlobalId` is given. */
  showEditLink?: boolean;
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  titleSort: 'Title sort',
  author: 'Author',
  authorSort: 'Author sort',
  subjects: 'Subjects',
  document: 'EPUB',
};

const labelFor = (fix: MetadataFix): string =>
  fix.kind === 'subjects-split' ? 'Subject' : (FIELD_LABEL[fix.field] ?? fix.field);

// The undo `kind` is stored as the internal action name ('apply'/'dismiss');
// surface it in the user-facing accept/reject language.
const UNDO_LABEL: Record<'apply' | 'dismiss', string> = {
  apply: 'accept',
  dismiss: 'reject',
};

export const FixReview = ({
  autoFixes,
  appliedFixes,
  proposals,
  onApplyFix,
  onApplyAll,
  onDismissFix,
  onDismissAll,
  onUndo,
  undo,
  disabled,
  bookGlobalId,
  showEditLink = true,
}: Props) => {
  const styles = useStyle();
  // True while a bulk fix action (Accept all / Reject all / Undo) is running,
  // so the buttons disable and a rapid second click can't re-trigger it.
  const [busy, setBusy] = useState(false);
  const actionable = proposals.filter((p) => p.to !== null);
  const pendingUndo = undo;

  // Lock the accept/reject controls while a bulk apply is running — either this
  // card's own (busy) or an external in-flight sweep (disabled) — so a stray
  // click can't race the in-flight apply.
  const controlsDisabled = busy || !!disabled;

  const runAction = async (action?: () => void | Promise<void>) => {
    if (!action || busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  if (
    autoFixes.length === 0 &&
    appliedFixes.length === 0 &&
    proposals.length === 0 &&
    !pendingUndo
  ) {
    return null;
  }

  return (
    <div className={styles.metadata}>
      {autoFixes.length > 0 && (
        <Fragment>
          <CardDivider>Automatic fixes</CardDivider>
          {autoFixes.map((fix) => (
            <div key={`auto-${fix.field}-${fix.kind}-${fix.from}`} className={styles.appliedRow}>
              <CheckIcon />
              <span className={styles.chipLine}>
                {labelFor(fix)}:{' '}
                {Object.keys(fix.changes).length === 0 ? (
                  // Structural repairs (e.g. the dcterms:modified fix) have no
                  // original field value — show just the description.
                  <strong>{fix.to}</strong>
                ) : (
                  <span>
                    {fix.from ? (
                      <span className={styles.fromValue}>{fix.from}</span>
                    ) : (
                      <em>empty</em>
                    )}
                    {' → '}
                    <strong>{fix.to}</strong>
                  </span>
                )}
              </span>
            </div>
          ))}
        </Fragment>
      )}

      {(proposals.length > 0 || pendingUndo) && (
        <CardDivider
          actions={
            pendingUndo ? (
              <Button type="link" disabled={busy} onClick={() => void runAction(onUndo)}>
                Undo {UNDO_LABEL[pendingUndo.kind]}
              </Button>
            ) : (
              <Fragment>
                {proposals.length >= 1 && (
                  <Button
                    type="link"
                    danger
                    disabled={controlsDisabled}
                    onClick={() => void runAction(onDismissAll)}
                  >
                    Reject all
                  </Button>
                )}
                {actionable.length >= 1 && (
                  <Button
                    type="link"
                    disabled={controlsDisabled}
                    onClick={() => void runAction(onApplyAll)}
                  >
                    Accept all
                  </Button>
                )}
              </Fragment>
            )
          }
        >
          Suggested fixes
        </CardDivider>
      )}

      {appliedFixes.map((fix) => (
        <div key={`applied-${fix.field}-${fix.kind}-${fix.from}`} className={styles.appliedRow}>
          <CheckIcon />
          <span className={styles.chipLine}>
            {labelFor(fix)}:{' '}
            {fix.toChips ? (
              <span className={styles.chipGroup}>
                {fix.toChips.map((c) => (
                  <Tag key={c} size="sm">
                    {c}
                  </Tag>
                ))}
              </span>
            ) : (
              <strong>{fix.to}</strong>
            )}
          </span>
        </div>
      ))}

      {proposals.length > 0 && (
        <div className={styles.proposalList}>
          {proposals.map((fix) => (
            <div key={`prop-${fix.field}-${fix.kind}-${fix.from}`} className={styles.proposalRow}>
              <div className={styles.proposalText}>
                <div className={styles.proposalMain}>
                  <span className={styles.fieldName}>{labelFor(fix)}:</span>
                  {fix.to === null ? (
                    <span className={styles.flagText}>needs review</span>
                  ) : fix.toChips ? (
                    <span className={styles.chipLine}>
                      {/* Left side matches the scalar "from" styling: struck-through,
                          faint text — not a chip. The split parts stay chips. */}
                      <span className={styles.fromValue}>{fix.from}</span>
                      {' → '}
                      <span className={styles.chipGroup}>
                        {fix.toChips.map((c) => (
                          <Tag key={c} size="sm">
                            {c}
                          </Tag>
                        ))}
                      </span>
                    </span>
                  ) : (
                    <span>
                      {fix.from ? (
                        <span className={styles.fromValue}>{fix.from}</span>
                      ) : (
                        <em>empty</em>
                      )}
                      {' → '}
                      <strong>{fix.to}</strong>
                    </span>
                  )}
                </div>
                {fix.reason && <span className={styles.reason}>{fix.reason}</span>}
              </div>
              <div className={styles.proposalActions}>
                {fix.to !== null ? (
                  <Fragment>
                    <Button
                      type="link"
                      danger
                      disabled={controlsDisabled}
                      onClick={() => onDismissFix(fix)}
                    >
                      Reject
                    </Button>
                    <Button type="link" disabled={controlsDisabled} onClick={() => onApplyFix(fix)}>
                      Accept
                    </Button>
                  </Fragment>
                ) : (
                  showEditLink &&
                  bookGlobalId && (
                    <Link to={path.bookEdit(bookGlobalId)} className={styles.editLink}>
                      Edit
                    </Link>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
