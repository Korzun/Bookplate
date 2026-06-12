# Loading Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a branded `LoadingPage` matching the login/password-reset layout, and extend all icon components to support `aria-label` and `role` props.

**Architecture:** Add `'aria-label'` and `role` to the shared `IconProps` type, thread them through all 15 icon SVG components, then create a new `LoadingPage` (identical centered layout to `LoginPage`) using `<SpinnerIcon role="status" aria-label="Loading" />`. Wire it into `ProtectedRoute` and update the test assertion.

**Tech Stack:** React, TypeScript, JSS (`createUseStyles` from `~/provider/theme`), `@testing-library/react`, vitest

---

## Task 1: Extend `IconProps` with `aria-label` and `role`

**Files:**
- Modify: `app/client/src/icon/props.ts`

- [ ] **Step 1: Add the new fields to `IconProps`**

`aria-label` contains a hyphen so it must be quoted in the TypeScript interface. Replace `app/client/src/icon/props.ts` with:

```ts
export type IconProps = {
  'aria-label'?: string;
  className?: string;
  fill?: string;
  height?: number;
  role?: string;
  stroke?: string;
  strokeWidth?: number;
  width?: number;
};

const defaultIconProps = {
  className: '',
  height: 24,
  width: 24,
};

export const defaultFilledIconProps = {
  ...defaultIconProps,
  fill: 'currentColor',
};

export const defaultStrokeIconProps = {
  ...defaultIconProps,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
};
```

- [ ] **Step 2: TypeScript check**

```bash
cd /workspaces/HASS-ODPS/app/client && npx tsc --noEmit 2>&1 | grep -v "node_modules" | grep "error" | head -20
```

Expected: no new errors. (Pre-existing errors in `app/server` are unrelated — ignore them.)

- [ ] **Step 3: Commit**

```bash
git add app/client/src/icon/props.ts
git commit -m "feat: add aria-label and role to IconProps"
```

---

## Task 2: Forward `aria-label` and `role` through all 15 icon components

**Files:**
- Modify: `app/client/src/icon/alert-octagon.tsx`
- Modify: `app/client/src/icon/book.tsx`
- Modify: `app/client/src/icon/books.tsx`
- Modify: `app/client/src/icon/check.tsx`
- Modify: `app/client/src/icon/chevron-circle.tsx`
- Modify: `app/client/src/icon/chevron.tsx`
- Modify: `app/client/src/icon/circle-x.tsx`
- Modify: `app/client/src/icon/clock.tsx`
- Modify: `app/client/src/icon/list-check.tsx`
- Modify: `app/client/src/icon/row-remove.tsx`
- Modify: `app/client/src/icon/spinner.tsx`
- Modify: `app/client/src/icon/upload.tsx`
- Modify: `app/client/src/icon/user.tsx`
- Modify: `app/client/src/icon/users.tsx`
- Modify: `app/client/src/icon/x.tsx`

**The pattern:** Because `aria-label` is a quoted key, destructuring requires an alias: `'aria-label': ariaLabel`. Add `ariaLabel` and `role` to every icon's destructure, then forward them to `<svg>`.

**Filled icons** (`defaultFilledIconProps`): destructure `'aria-label': ariaLabel, className, fill, height, role, width`.

**Stroke icons** (`defaultStrokeIconProps`): destructure `'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width`.

- [ ] **Step 1: Replace `alert-octagon.tsx`** (filled)

```tsx
import { IconProps, defaultFilledIconProps } from './props';

// https://tabler.io/icons?icon=alert-octagon
export const AlertOctagonIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, width } = { ...defaultFilledIconProps, ...props };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M14.897 1a4 4 0 0 1 2.664 1.016l.165 .156l4.1 4.1a4 4 0 0 1 1.168 2.605l.006 .227v5.794a4 4 0 0 1 -1.016 2.664l-.156 .165l-4.1 4.1a4 4 0 0 1 -2.603 1.168l-.227 .006h-5.795a3.999 3.999 0 0 1 -2.664 -1.017l-.165 -.156l-4.1 -4.1a4 4 0 0 1 -1.168 -2.604l-.006 -.227v-5.794a4 4 0 0 1 1.016 -2.664l.156 -.165l4.1 -4.1a4 4 0 0 1 2.605 -1.168l.227 -.006h5.793zm-2.887 14l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -8a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z" />
    </svg>
  );
};
```

- [ ] **Step 2: Replace `book.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=book-2
export const BookIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M19 4v16h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12" />
      <path d="M19 16h-12a2 2 0 0 0 -2 2" />
      <path d="M9 8h6" />
    </svg>
  );
};
```

- [ ] **Step 3: Replace `books.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=books
export const BooksIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -14" />
      <path d="M9 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -14" />
      <path d="M5 8h4" />
      <path d="M9 16h4" />
      <path d="M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041" />
      <path d="M14 9l4 -1" />
      <path d="M16 16l3.923 -.98" />
    </svg>
  );
};
```

- [ ] **Step 4: Replace `check.tsx`** (filled)

```tsx
import { IconProps, defaultFilledIconProps } from './props';

// https://tabler.io/icons?icon=check
export const CheckIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, width } = { ...defaultFilledIconProps, ...props };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M20.707 6.293a1 1 0 0 1 0 1.414l-10 10a1 1 0 0 1 -1.414 0l-5 -5a1 1 0 0 1 1.414 -1.414l4.293 4.293l9.293 -9.293a1 1 0 0 1 1.414 0" />
    </svg>
  );
};
```

- [ ] **Step 5: Replace `chevron-circle.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=circle-chevron-right
export const ChevronCircleIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };
  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M11 9l3 3l-3 3" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
    </svg>
  );
};
```

- [ ] **Step 6: Replace `chevron.tsx`** (stroke — also fixes `stroke-width` → `strokeWidth` typo)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=chevron-right
export const ChevronIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };
  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
};
```

- [ ] **Step 7: Replace `circle-x.tsx`** (filled)

```tsx
import { IconProps, defaultFilledIconProps } from './props';

// https://tabler.io/icons?icon=circle-x
export const CircleXIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, width } = { ...defaultFilledIconProps, ...props };
  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-6.489 5.8a1 1 0 0 0 -1.218 1.567l1.292 1.293l-1.292 1.293l-.083 .094a1 1 0 0 0 1.497 1.32l1.293 -1.292l1.293 1.292l.094 .083a1 1 0 0 0 1.32 -1.497l-1.292 -1.293l1.292 -1.293l.083 -.094a1 1 0 0 0 -1.497 -1.32l-1.293 1.292l-1.293 -1.292l-.094 -.083z" />
    </svg>
  );
};
```

- [ ] **Step 8: Replace `clock.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons/icon/clock
export const ClockIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
};
```

- [ ] **Step 9: Replace `list-check.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=list-check
export const ListCheckIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3.5 5.5l1.5 1.5l2.5 -2.5" />
      <path d="M3.5 17.5l1.5 1.5l2.5 -2.5" />
      <path d="M11 6l9 0" />
      <path d="M11 12l9 0" />
      <path d="M11 18l9 0" />
    </svg>
  );
};
```

- [ ] **Step 10: Replace `row-remove.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=row-remove
export const RowRemoveIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };
  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1" />
      <path d="M10 16l4 4" />
      <path d="M10 20l4 -4" />
    </svg>
  );
};
```

- [ ] **Step 11: Replace `spinner.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

export const SpinnerIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill="none"
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12,1 C18,1 23,6 23,12" />
    </svg>
  );
};
```

- [ ] **Step 12: Replace `upload.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons/icon/upload
export const UploadIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
      <path d="M7 9l5 -5l5 5" />
      <path d="M12 4l0 12" />
    </svg>
  );
};
```

- [ ] **Step 13: Replace `user.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=user
export const UserIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    </svg>
  );
};
```

- [ ] **Step 14: Replace `users.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=users
export const UsersIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
      <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />
    </svg>
  );
};
```

- [ ] **Step 15: Replace `x.tsx`** (stroke)

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=x
export const XIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </svg>
  );
};
```

- [ ] **Step 16: TypeScript check**

```bash
cd /workspaces/HASS-ODPS/app/client && npx tsc --noEmit 2>&1 | grep -v "node_modules" | grep "error" | head -20
```

Expected: no new errors in any `icon/` file.

- [ ] **Step 17: Commit**

```bash
git add app/client/src/icon/
git commit -m "feat: forward aria-label and role through all icon components"
```

---

## Task 3: Create `LoadingPage` and wire it up

**Files:**
- Create: `app/client/src/page/loading/index.tsx`
- Create: `app/client/src/page/loading/style.ts`
- Modify: `app/client/src/page/index.ts`
- Modify: `app/client/src/router/protected-route.tsx`
- Modify: `app/client/src/router/protected-route.test.tsx`

- [ ] **Step 1: Create `app/client/src/page/loading/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: theme.color.bg.page,
    padding: `0 ${theme.space.xxl}`,
  },
  title: {
    margin: `0 0 ${theme.space.xxxxl}`,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
    fontWeight: theme.fontWeight.semibold,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    justifyContent: 'center',
  },
  spinner: {
    ...theme.recipe.spinner,
    height: '2rem',
    width: '2rem',
  },
}));
```

- [ ] **Step 2: Create `app/client/src/page/loading/index.tsx`**

```tsx
import { Page } from '~/component';
import { BooksIcon, SpinnerIcon } from '~/icon';

import { useStyle } from './style';

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

- [ ] **Step 3: Export `LoadingPage` from `app/client/src/page/index.ts`**

```ts
export { BookEditPage } from './book-edit';
export { BookPage } from './book';
export { LibraryPage } from './library';
export { LoadingPage } from './loading';
export { LoginPage } from './login';
export { PasswordResetPage } from './password-reset';
export { SeriesPage } from './series';
export { UploadPage } from './upload';
export { UserListPage } from './user-list';
export { UserPage } from './user';
```

- [ ] **Step 4: Update `app/client/src/router/protected-route.tsx`**

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { LoadingPage } from '../page';
import { useMustChangePassword, useUsername } from '../provider/auth';

import * as path from './path-internal';

export const ProtectedRoute = () => {
  const [username, loading] = useUsername();
  const [mustChangePassword] = useMustChangePassword();
  const location = useLocation();
  if (!username && loading === true) {
    return <LoadingPage />;
  }
  if (!username) {
    return <Navigate to={path.login()} state={{ from: location }} replace />;
  }
  if (!mustChangePassword && location.pathname === path.passwordReset()) {
    return <Navigate to={path.home()} replace />;
  }
  if (mustChangePassword && location.pathname !== path.passwordReset()) {
    return <Navigate to={path.passwordReset()} replace />;
  }
  return <Outlet />;
};
```

- [ ] **Step 5: Update the loading assertion in `app/client/src/router/protected-route.test.tsx`**

Find the test named `'shows loading when not authenticated and loading'` and change its final assertion from:

```tsx
expect(screen.getByText('loading...')).toBeInTheDocument();
```

to:

```tsx
expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
```

All other tests in the file remain unchanged.

- [ ] **Step 6: TypeScript check**

```bash
cd /workspaces/HASS-ODPS/app/client && npx tsc --noEmit 2>&1 | grep -v "node_modules" | grep "error" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/page/loading/ app/client/src/page/index.ts app/client/src/router/protected-route.tsx app/client/src/router/protected-route.test.tsx
git commit -m "feat: add LoadingPage and wire into ProtectedRoute"
```
