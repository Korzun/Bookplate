import { describe, expect, it, vi } from 'vitest';

import { buildBookActions, type BookActionHandlers } from './actions';

function handlers(): BookActionHandlers {
  return {
    onSetProgress: vi.fn(),
    onEditMetadata: vi.fn(),
    onShowLineage: vi.fn(),
    onRegenChapters: vi.fn(),
    onClearEditions: vi.fn(),
    onValidate: vi.fn(),
    onUploadReplace: vi.fn(),
    onDownloadBook: vi.fn(),
    onDeleteBook: vi.fn(),
  };
}

describe('buildBookActions', () => {
  it('includes Set progress as a leading primary when there are chapters', () => {
    const actions = buildBookActions(
      {
        chapterCount: 5,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    );
    const setProgress = actions.find((a) => a.label === 'Set progress');
    expect(setProgress).toMatchObject({ primary: true, align: 'leading' });
  });

  it('omits Set progress when there are no chapters', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Set progress')).toBeUndefined();
  });

  it('marks Edit metadata as a trailing primary', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Edit metadata')).toMatchObject({
      primary: true,
      align: 'trailing',
    });
  });

  it('labels Clear device editions with the count and disables it at zero', () => {
    const zero = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    ).find((a) => a.label.startsWith('Clear device editions'));
    expect(zero).toMatchObject({ label: 'Clear device editions (0)', disabled: true });

    const three = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 3,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    ).find((a) => a.label.startsWith('Clear device editions'));
    expect(three).toMatchObject({ label: 'Clear device editions (3)', disabled: false });
  });

  it('disables Regen chapters while a regen is loading', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: true,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Regen chapters')).toMatchObject({ disabled: true });
  });

  it('marks Delete as danger and non-primary', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    );
    const del = actions.find((a) => a.label === 'Delete');
    expect(del).toMatchObject({ danger: true, separatorBefore: true });
    expect(del?.primary).toBeUndefined();
  });

  it('wires each handler to the matching action', () => {
    const h = handlers();
    const actions = buildBookActions(
      {
        chapterCount: 5,
        deviceEditionCount: 2,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      h
    );
    actions.find((a) => a.label === 'Set progress')?.onClick();
    actions.find((a) => a.label === 'Delete')?.onClick();
    expect(h.onSetProgress).toHaveBeenCalledTimes(1);
    expect(h.onDeleteBook).toHaveBeenCalledTimes(1);
  });

  it('adds a non-primary Book lineage overflow action wired to onShowLineage', () => {
    const h = handlers();
    const actions = buildBookActions(
      {
        chapterCount: 5,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      h
    );
    const lineage = actions.find((a) => a.label === 'Book lineage');
    expect(lineage).toBeDefined();
    expect(lineage?.primary).toBeUndefined();
    expect(lineage?.danger).toBeUndefined();
    lineage?.onClick();
    expect(h.onShowLineage).toHaveBeenCalledTimes(1);
  });

  it('places Download between Clear device editions and Delete, with a separator before it', () => {
    const h = handlers();
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 2,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      h
    );
    const labels = actions.map((a) => a.label);
    const clearIdx = labels.findIndex((l) => l.startsWith('Clear device editions'));
    const downloadIdx = labels.indexOf('Download');
    const deleteIdx = labels.indexOf('Delete');
    expect(clearIdx).toBeLessThan(downloadIdx);
    expect(downloadIdx).toBeLessThan(deleteIdx);

    const download = actions[downloadIdx];
    expect(download).toMatchObject({ separatorBefore: true });
    expect(download.danger).toBeUndefined();

    download.onClick();
    expect(h.onDownloadBook).toHaveBeenCalledTimes(1);
  });

  it('places Validate directly below Clear device editions and above Download', () => {
    const h = handlers();
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 2,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      h
    );
    const labels = actions.map((a) => a.label);
    const clearIdx = labels.findIndex((l) => l.startsWith('Clear device editions'));
    const validateIdx = labels.indexOf('Validate');
    const downloadIdx = labels.indexOf('Download');
    expect(validateIdx).toBe(clearIdx + 1);
    expect(validateIdx).toBeLessThan(downloadIdx);
    const validate = actions[validateIdx];
    expect(validate.danger).toBeUndefined();
    expect(validate.separatorBefore).toBeUndefined();
    validate.onClick();
    expect(h.onValidate).toHaveBeenCalledTimes(1);
  });

  it('disables Validate while validating', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: true,
        editingBlocked: false,
      },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Validate')).toMatchObject({ disabled: true });
  });

  it('includes Upload and replace after Validate, enabled even when editing is blocked', () => {
    const h = handlers();
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: true,
      },
      h
    );
    const labels = actions.map((a) => a.label);
    const validateIdx = labels.indexOf('Validate');
    const replaceIdx = labels.indexOf('Upload and replace');
    expect(replaceIdx).toBe(validateIdx + 1);
    const item = actions[replaceIdx];
    expect(item.disabled).toBeFalsy(); // enabled even when editingBlocked
    item.onClick();
    expect(h.onUploadReplace).toHaveBeenCalledTimes(1);
  });

  it('disables Edit metadata and Regen chapters when editing is blocked', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: true,
      },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Edit metadata')).toMatchObject({ disabled: true });
    expect(actions.find((a) => a.label === 'Regen chapters')).toMatchObject({ disabled: true });
  });

  it('enables Edit metadata and Regen chapters when not blocked', () => {
    const actions = buildBookActions(
      {
        chapterCount: 0,
        deviceEditionCount: 0,
        regenLoading: false,
        validating: false,
        editingBlocked: false,
      },
      handlers()
    );
    expect(actions.find((a) => a.label === 'Edit metadata')?.disabled).toBeFalsy();
    expect(actions.find((a) => a.label === 'Regen chapters')?.disabled).toBeFalsy();
  });
});
