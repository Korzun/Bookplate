import { describe, expect, it, vi } from 'vitest';

import { buildBookActions, type BookActionHandlers } from './actions';

function handlers(): BookActionHandlers {
  return {
    onSetProgress: vi.fn(),
    onEditMetadata: vi.fn(),
    onRegenChapters: vi.fn(),
    onClearEditions: vi.fn(),
    onDeleteBook: vi.fn(),
  };
}

describe('buildBookActions', () => {
  it('includes Set progress as a leading primary when there are chapters', () => {
    const actions = buildBookActions(
      { chapterCount: 5, deviceEditionCount: 0, regenLoading: false },
      handlers()
    );
    const setProgress = actions.find((a) => a.label === 'Set progress');
    expect(setProgress).toMatchObject({ primary: true, align: 'leading' });
  });

  it('omits Set progress when there are no chapters', () => {
    const actions = buildBookActions(
      { chapterCount: 0, deviceEditionCount: 0, regenLoading: false },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Set progress')).toBeUndefined();
  });

  it('marks Edit metadata as a trailing primary', () => {
    const actions = buildBookActions(
      { chapterCount: 0, deviceEditionCount: 0, regenLoading: false },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Edit metadata')).toMatchObject({
      primary: true,
      align: 'trailing',
    });
  });

  it('labels Clear device editions with the count and disables it at zero', () => {
    const zero = buildBookActions(
      { chapterCount: 0, deviceEditionCount: 0, regenLoading: false },
      handlers()
    ).find((a) => a.label.startsWith('Clear device editions'));
    expect(zero).toMatchObject({ label: 'Clear device editions (0)', disabled: true });

    const three = buildBookActions(
      { chapterCount: 0, deviceEditionCount: 3, regenLoading: false },
      handlers()
    ).find((a) => a.label.startsWith('Clear device editions'));
    expect(three).toMatchObject({ label: 'Clear device editions (3)', disabled: false });
  });

  it('disables Regen chapters while a regen is loading', () => {
    const actions = buildBookActions(
      { chapterCount: 0, deviceEditionCount: 0, regenLoading: true },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Regen chapters')).toMatchObject({ disabled: true });
  });

  it('marks Delete book as danger and non-primary', () => {
    const actions = buildBookActions(
      { chapterCount: 0, deviceEditionCount: 0, regenLoading: false },
      handlers()
    );
    const del = actions.find((a) => a.label === 'Delete book');
    expect(del).toMatchObject({ danger: true });
    expect(del?.primary).toBeUndefined();
  });

  it('wires each handler to the matching action', () => {
    const h = handlers();
    const actions = buildBookActions(
      { chapterCount: 5, deviceEditionCount: 2, regenLoading: false },
      h
    );
    actions.find((a) => a.label === 'Set progress')?.onClick();
    actions.find((a) => a.label === 'Delete book')?.onClick();
    expect(h.onSetProgress).toHaveBeenCalledTimes(1);
    expect(h.onDeleteBook).toHaveBeenCalledTimes(1);
  });
});
