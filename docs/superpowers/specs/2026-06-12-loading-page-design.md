# Loading Page Design

## Overview

Replace the bare `<div>loading...</div>` in `ProtectedRoute` with a proper `LoadingPage` that matches the visual language of the existing pre-auth pages (login, password-reset). Simultaneously, add `aria-label` and `role` to `IconProps` and thread them through all icon components so icons can carry accessible names when needed.

## Motivation

The loading state appears when `ProtectedRoute` has no username yet and is still checking auth (e.g. initial page load). It previously rendered raw text in the top-left corner. The new page should feel consistent with login and password-reset — centered, branded, and properly accessible.

## Design

### Visual

Matches the login/password-reset layout exactly:

- `<Page type="minimal">` wrapper (no header, noise texture background)
- Full-height centered flex column
- `<BooksIcon /> HASS-ODPS` heading (same styles as login)
- `<SpinnerIcon role="status" aria-label="Loading" />` below the heading, using `theme.recipe.spinner` at a slightly larger size than the button spinner

### Files changed

#### `src/icon/props.ts`
Add two optional fields to `IconProps`. `aria-label` contains a hyphen so it must be quoted in the TypeScript interface:
```ts
'aria-label'?: string;
role?: string;
```

#### All 15 icon components
Each component destructures its props and forwards them individually to the `<svg>` element. Add `aria-label` and `role` to the destructure list and forward to `<svg>` in every component.

Because `aria-label` is a quoted key, destructuring requires an alias:
```ts
const { 'aria-label': ariaLabel, role, ...rest } = { ...defaultStrokeIconProps, ...props };
// then on the svg:
<svg aria-label={ariaLabel} role={role} ... />
```

- `alert-octagon.tsx`
- `book.tsx`
- `books.tsx`
- `check.tsx`
- `chevron-circle.tsx`
- `chevron.tsx` — also fix existing `stroke-width` → `strokeWidth` typo on the `<svg>`
- `circle-x.tsx`
- `clock.tsx`
- `list-check.tsx`
- `row-remove.tsx`
- `spinner.tsx`
- `upload.tsx`
- `user.tsx`
- `users.tsx`
- `x.tsx`

#### `src/page/loading/index.tsx` (new)
```tsx
export const LoadingPage = () => {
  const styles = useStyle();
  return (
    <Page type="minimal">
      <div className={styles.root}>
        <h1 className={styles.title}>
          <BooksIcon /> HASS-ODPS
        </h1>
        <SpinnerIcon role="status" aria-label="Loading" className={styles.spinner} />
      </div>
    </Page>
  );
};
```

#### `src/page/loading/style.ts` (new)
- `root`: identical to login — full-height centering (`minHeight: '100vh'`, `display: 'flex'`, `alignItems: 'center'`, `justifyContent: 'center'`, `flexDirection: 'column'`, `backgroundColor: theme.color.bg.page`, padding)
- `title`: identical to login — font size, weight, color, gap, flex alignment
- `spinner`: `...theme.recipe.spinner` with `height`/`width` set to `'2rem'` (larger than the `1em` button spinner)

#### `src/page/index.ts`
Add: `export { LoadingPage } from './loading';`

#### `src/router/protected-route.tsx`
Replace:
```tsx
return <div>loading...</div>;
```
With:
```tsx
return <LoadingPage />;
```

#### `src/router/protected-route.test.tsx`
In the `'shows loading when not authenticated and loading'` test, replace:
```tsx
expect(screen.getByText('loading...')).toBeInTheDocument();
```
With:
```tsx
expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
```

### Accessibility

`role="status"` is a ARIA live region — screen readers will announce it when it appears. `aria-label="Loading"` gives it an accessible name. These are passed as props on `SpinnerIcon`, which now forwards them to its `<svg>` element via the updated `IconProps`.

### What is not in scope

- Updating other icon components to use `aria-label`/`role` at their call sites — this spec only adds the capability; callers opt in as needed
- Any animation changes to the spinner — it uses the existing `theme-rotation` keyframe
- Dark mode or theme variants — the loading page uses the same tokens as login
