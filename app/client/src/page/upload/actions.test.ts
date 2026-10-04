import { describe, expect, it, vi } from 'vitest';

import { buildUploadActions, type UploadActionHandlers } from './actions';

function handlers(): UploadActionHandlers {
  return {
    onDismissAll: vi.fn(),
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
  };
}

const allFalse = { hasDismissible: false, hasActionable: false, hasProposals: false };

describe('buildUploadActions', () => {
  it('puts Clear finished first, as an overflow item starting the menu', () => {
    const actions = buildUploadActions(allFalse, handlers());
    expect(actions[0].label).toBe('Clear finished');
    // Overflow (no inline button) and no divider above it — it starts the menu.
    expect(actions[0].primary).toBeUndefined();
    expect(actions[0].separatorBefore).toBeUndefined();
  });

  it('sets a separator before Accept all, dividing Clear finished from the fix decisions', () => {
    const accept = buildUploadActions(allFalse, handlers()).find((a) => a.label === 'Accept all');
    expect(accept).toMatchObject({ separatorBefore: true });
  });

  it('puts Accept all and Reject all in the overflow menu (no primary)', () => {
    const actions = buildUploadActions(allFalse, handlers());
    const accept = actions.find((a) => a.label === 'Accept all');
    const reject = actions.find((a) => a.label === 'Reject all');
    expect(accept?.primary).toBeUndefined();
    expect(reject?.primary).toBeUndefined();
  });

  it('marks Reject all as danger', () => {
    const reject = buildUploadActions(allFalse, handlers()).find((a) => a.label === 'Reject all');
    expect(reject).toMatchObject({ danger: true });
  });

  it('disables Clear finished unless there are dismissible rows', () => {
    expect(
      buildUploadActions(allFalse, handlers()).find((a) => a.label === 'Clear finished')?.disabled
    ).toBe(true);
    expect(
      buildUploadActions({ ...allFalse, hasDismissible: true }, handlers()).find(
        (a) => a.label === 'Clear finished'
      )?.disabled
    ).toBe(false);
  });

  it('disables Accept all unless there are actionable proposals', () => {
    expect(
      buildUploadActions(allFalse, handlers()).find((a) => a.label === 'Accept all')?.disabled
    ).toBe(true);
    expect(
      buildUploadActions({ ...allFalse, hasActionable: true }, handlers()).find(
        (a) => a.label === 'Accept all'
      )?.disabled
    ).toBe(false);
  });

  it('disables Reject all unless there are proposals', () => {
    expect(
      buildUploadActions(allFalse, handlers()).find((a) => a.label === 'Reject all')?.disabled
    ).toBe(true);
    expect(
      buildUploadActions({ ...allFalse, hasProposals: true }, handlers()).find(
        (a) => a.label === 'Reject all'
      )?.disabled
    ).toBe(false);
  });

  it('wires each handler to the matching action', () => {
    const h = handlers();
    const actions = buildUploadActions({ ...allFalse }, h);
    actions.find((a) => a.label === 'Clear finished')?.onClick();
    actions.find((a) => a.label === 'Accept all')?.onClick();
    actions.find((a) => a.label === 'Reject all')?.onClick();
    expect(h.onDismissAll).toHaveBeenCalledTimes(1);
    expect(h.onAcceptAll).toHaveBeenCalledTimes(1);
    expect(h.onRejectAll).toHaveBeenCalledTimes(1);
  });
});
