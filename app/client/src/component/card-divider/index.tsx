import cx from 'classnames';
import type { ReactNode } from 'react';

import { useStyle } from './style';

export type CardDividerAlign = 'left' | 'center' | 'right';

export type CardDividerProps = {
  // Optional label. Without it (and without actions) the divider is a plain full-width line.
  children?: ReactNode;
  // Where the label sits. Left/right hug that edge with a short stub of line poking past;
  // center leaves equal line on both sides.
  align?: CardDividerAlign;
  // Optional actions rendered on the divider line (e.g. a bulk-action button).
  actions?: ReactNode;
  // Where the actions sit. When actions share a position with the label they stack in the
  // same group — label first, then actions.
  actionsAlign?: CardDividerAlign;
};

const isPresent = (node: ReactNode): boolean =>
  node !== undefined && node !== null && node !== false;

export const CardDivider = ({
  children,
  align = 'left',
  actions,
  actionsAlign = 'right',
}: CardDividerProps) => {
  const style = useStyle();

  const hasLabel = isPresent(children);
  const hasActions = isPresent(actions);

  if (!hasLabel && !hasActions) {
    return (
      <div className={style.root} role="separator">
        <span className={style.line} />
      </div>
    );
  }

  // Bucket the label and actions into positions; within a bucket the label renders first.
  const groups: Record<CardDividerAlign, ReactNode[]> = { left: [], center: [], right: [] };
  if (hasLabel) {
    groups[align].push(
      <span key="label" className={style.label}>
        {children}
      </span>
    );
  }
  if (hasActions) {
    groups[actionsAlign].push(
      <span key="actions" className={style.actions}>
        {actions}
      </span>
    );
  }

  const slot = (pos: CardDividerAlign) =>
    groups[pos].length > 0 ? <span className={style.group}>{groups[pos]}</span> : null;

  return (
    <div className={style.root} role="separator">
      <span className={cx(style.line, groups.left.length > 0 && style.stub)} />
      {slot('left')}
      <span className={style.line} />
      {slot('center')}
      <span className={style.line} />
      {slot('right')}
      <span className={cx(style.line, groups.right.length > 0 && style.stub)} />
    </div>
  );
};
