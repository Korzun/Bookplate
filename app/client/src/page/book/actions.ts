import { type PageActionItem } from '~/control';

export interface BookActionState {
  chapterCount: number;
  deviceEditionCount: number;
  regenLoading: boolean;
}

export interface BookActionHandlers {
  onSetProgress: () => void;
  onEditMetadata: () => void;
  onShowLineage: () => void;
  onRegenChapters: () => void;
  onClearEditions: () => void;
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
  });

  actions.push({
    label: 'Book lineage',
    onClick: handlers.onShowLineage,
  });

  actions.push({
    label: 'Regen chapters',
    onClick: handlers.onRegenChapters,
    disabled: state.regenLoading,
  });

  actions.push({
    label: `Clear device editions (${state.deviceEditionCount})`,
    onClick: handlers.onClearEditions,
    disabled: state.deviceEditionCount === 0,
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
