import { type PageActionItem } from '~/control';

export interface BookActionState {
  chapterCount: number;
  deviceEditionCount: number;
  regenLoading: boolean;
}

export interface BookActionHandlers {
  onSetProgress: () => void;
  onEditMetadata: () => void;
  onRegenChapters: () => void;
  onClearEditions: () => void;
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
    label: 'Delete book',
    onClick: handlers.onDeleteBook,
    danger: true,
  });

  return actions;
}
