import { type PageActionItem } from '~/control';

export interface BookActionState {
  chapterCount: number;
  deviceEditionCount: number;
  regenLoading: boolean;
  validating: boolean;
  editingBlocked: boolean;
}

export interface BookActionHandlers {
  onSetProgress: () => void;
  onEditMetadata: () => void;
  onShowLineage: () => void;
  onRegenChapters: () => void;
  onClearEditions: () => void;
  onValidate: () => void;
  onUploadReplace: () => void;
  onDownloadBook: () => void;
  onDeleteBook: () => void;
}

// The overflow menu is grouped by what each action does to the book, with a
// divider (`separatorBefore` on each group's first item) between groups:
//   1. Set progress            — reading
//   2. Validate / Upload…      — check the file's health, then fix it
//   3. Regen / Clear editions  — rebuild derived data
//   4. Book lineage / Download — the book itself: history & file
//   5. Delete                  — destructive
// Edit metadata stays a primary (a button in the actions bar), not in a group.
export function buildBookActions(
  state: BookActionState,
  handlers: BookActionHandlers
): PageActionItem[] {
  const actions: PageActionItem[] = [];

  // Reading
  if (state.chapterCount > 0) {
    actions.push({
      label: 'Set progress',
      onClick: handlers.onSetProgress,
    });
  }

  // Editing — the one primary action (rendered as a button in the bar).
  actions.push({
    label: 'Edit metadata',
    onClick: handlers.onEditMetadata,
    primary: true,
    align: 'trailing',
    disabled: state.editingBlocked,
  });

  // Validate & fix the file
  actions.push({
    label: 'Validate',
    onClick: handlers.onValidate,
    disabled: state.validating,
    separatorBefore: true,
  });
  actions.push({
    label: 'Upload and replace',
    onClick: handlers.onUploadReplace,
  });

  // Rebuild derived data
  actions.push({
    label: 'Regen chapters',
    onClick: handlers.onRegenChapters,
    disabled: state.regenLoading || state.editingBlocked,
    separatorBefore: true,
  });
  actions.push({
    label: `Clear device editions (${state.deviceEditionCount})`,
    onClick: handlers.onClearEditions,
    disabled: state.deviceEditionCount === 0,
  });

  // The book: history & file
  actions.push({
    label: 'Book lineage',
    onClick: handlers.onShowLineage,
    separatorBefore: true,
  });
  actions.push({
    label: 'Download',
    onClick: handlers.onDownloadBook,
  });

  // Destructive
  actions.push({
    label: 'Delete',
    onClick: handlers.onDeleteBook,
    danger: true,
    separatorBefore: true,
  });

  return actions;
}
