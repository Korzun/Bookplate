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
  onDownloadBook: () => void;
  onDeleteBook: () => void;
}

export function buildBookActions(
  state: BookActionState,
  handlers: BookActionHandlers
): PageActionItem[] {
  const actions: PageActionItem[] = [];

  if (state.chapterCount > 0) {
    actions.push({
      label: 'Set progress',
      onClick: handlers.onSetProgress,
      primary: true,
      align: 'leading',
    });
  }

  actions.push({
    label: 'Edit metadata',
    onClick: handlers.onEditMetadata,
    primary: true,
    align: 'trailing',
    disabled: state.editingBlocked,
  });

  actions.push({
    label: 'Book lineage',
    onClick: handlers.onShowLineage,
  });

  actions.push({
    label: 'Regen chapters',
    onClick: handlers.onRegenChapters,
    disabled: state.regenLoading || state.editingBlocked,
  });

  actions.push({
    label: `Clear device editions (${state.deviceEditionCount})`,
    onClick: handlers.onClearEditions,
    disabled: state.deviceEditionCount === 0,
  });

  actions.push({
    label: 'Validate',
    onClick: handlers.onValidate,
    disabled: state.validating,
  });

  actions.push({
    label: 'Download',
    onClick: handlers.onDownloadBook,
    separatorBefore: true,
  });

  actions.push({
    label: 'Delete',
    onClick: handlers.onDeleteBook,
    danger: true,
    // Set the destructive action off from the rest with a divider. (The menu no
    // longer derives separators from `danger` alone, so ask for it explicitly.)
    separatorBefore: true,
  });

  return actions;
}
