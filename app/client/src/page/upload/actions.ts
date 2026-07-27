import { type PageActionItem } from '~/control';

export interface UploadActionState {
  /** Any row that individually offers a "Clear upload" action (failed, or
   * done with no pending proposals). */
  hasDismissible: boolean;
  /** Any row has at least one proposal with a non-null target (Accept-able). */
  hasActionable: boolean;
  /** Any row has at least one pending proposal (Reject-able). */
  hasProposals: boolean;
}

export interface UploadActionHandlers {
  onDismissAll: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function buildUploadActions(
  state: UploadActionState,
  handlers: UploadActionHandlers
): PageActionItem[] {
  return [
    // Every action lives in the "Actions" overflow menu (the page has no inline
    // buttons). "Clear finished" sits in its own group at the top — a
    // queue-tidying action, set off by a divider from the fix decisions below.
    {
      label: 'Clear finished',
      onClick: handlers.onDismissAll,
      disabled: !state.hasDismissible,
    },
    {
      label: 'Accept all',
      onClick: handlers.onAcceptAll,
      disabled: !state.hasActionable,
      separatorBefore: true,
    },
    {
      label: 'Reject all',
      onClick: handlers.onRejectAll,
      disabled: !state.hasProposals,
      danger: true,
    },
  ];
}
