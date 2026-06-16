# Cover Image Picker — Design Spec

**Date:** 2026-06-16
**Branch:** feat/ui-nitpicks-part-2

## Problem

The "Cover Image" card in `<BookEditForm>` is a bare `<input type="file" />` — no filename display, no thumbnail preview, visually inconsistent with the rest of the form. `<UploadItem>` shows a polished card with a status icon, label row, and progress bar; the cover image card should feel like it belongs in the same family.

## Decision

Create a new dedicated `CoverImagePicker` component that visually mirrors `UploadItem`'s row style (icon slot + filename + size label) and shows a live thumbnail of the selected image. `UploadItem` is left untouched — the two components serve different purposes (async upload queue vs. synchronous form field) and should not be coupled.

## Component API

```
app/client/src/component/cover-image-picker/
  index.tsx
  style.ts
```

```tsx
interface Props {
  value: File | undefined;
  onChange: (file: File | undefined) => void;
}
```

`CoverImagePicker` owns its own `<Card title="Cover Image">` wrapper, matching the pattern used by `UploadItem`.

## Visual Structure

### Idle state (no file selected)

```
┌─ Cover Image ────────────────────────────────┐
│  [□ placeholder icon]  No image selected  —  │
│  [Choose image…]                             │
└──────────────────────────────────────────────┘
```

- Left slot: 32×32 square with a faint image placeholder icon
- Center: "No image selected" in `color.text.faint`
- Right: `—` in `color.text.faint`
- Below row: "Choose image…" button

### Selected state (file chosen)

```
┌─ Cover Image ────────────────────────────────┐
│  [thumbnail]  cover.jpg              1.2 MB  │
│  [Change…]  [Clear]                          │
└──────────────────────────────────────────────┘
```

- Left slot: 32×32 square thumbnail (`object-fit: cover`, `border-radius: 4px`)
- Center: filename, truncated with ellipsis, medium font weight
- Right: file size in MB (one decimal place)
- Below row: "Change…" button + "Clear" button (no `type` prop — same plain variant as "Cancel" in `BookEditForm`)

## Behavior

### File picker
A hidden `<input type="file" accept="image/*" ref={inputRef}>` is triggered by clicking "Choose image…" or "Change…" via `inputRef.current?.click()`.

### Thumbnail URL lifecycle
```tsx
useEffect(() => {
  if (!value) return;
  const url = URL.createObjectURL(value);
  setThumbnailUrl(url);
  return () => URL.revokeObjectURL(url);
}, [value]);
```
The object URL is created when a file is selected and revoked when the file changes or the component unmounts, preventing memory leaks.

### Clear button
Calls `onChange(undefined)`, returning the card to idle state. Rendered only when `value` is defined.

## Styles

`style.ts` mirrors the row/label structure from `upload-item/style.ts`:
- `.row` — `display: flex; align-items: center; gap: theme.space.xs`
- `.thumbSlot` — 32×32, `border-radius: 4px`, `border: 1px solid theme.color.border.default`, `overflow: hidden`
- `.filename` — `font-size: theme.fontSize.sm`, `flex-grow: 1`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`
- `.size` — `font-size: theme.fontSize.xs`, `color: theme.color.text.faint`, `white-space: nowrap`
- `.actions` — `display: flex; gap: theme.space.sm; margin-top: theme.space.xs`

## Integration

In `BookEditForm`, replace:

```tsx
<Card title="Cover Image">
  <input type="file" accept="image/*" onChange={handleCoverChange} />
</Card>
```

with:

```tsx
<CoverImagePicker value={cover} onChange={setCover} />
```

`handleCoverChange` is removed. `setCover` is the existing state setter — it already accepts `File | undefined`.

## Out of scope

- Drag-and-drop
- Image cropping or resizing
- Showing the book's existing server-side cover image (this is an upload-only field)
