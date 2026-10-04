import cx from 'classnames';
import { ReactNode, useCallback, useEffect, useId, useState } from 'react';

import { SpinnerIcon } from '~/icon';

import { SwitchRadius, SwitchRadiusValue, useStyle } from './style';

/**
 * How long a save may run before the switch admits to it.
 *
 * Every mutation behind a switch in this app is local — a preference row, a
 * push subscription — and normally settles in well under this. Showing the
 * spinner the instant a click fires would therefore flash it for two or three
 * frames on nearly every interaction, which reads as a glitch rather than as
 * feedback. Waiting means the common path shows nothing at all, and only a
 * genuinely slow save (a busy server, a dropped connection) ever draws one.
 */
const SPINNER_DELAY_MS = 150;

/**
 * True once `active` has been continuously true for `delayMs`, false the
 * moment it clears.
 *
 * The delay is PURELY VISUAL. Both the click guard and `aria-busy` below read
 * the undelayed prop instead, because suppressing the spinner for 150ms must
 * not also open a 150ms window in which a second click fires a second
 * mutation, nor hide the state from a screen reader that has no flicker to be
 * spared.
 */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return elapsed;
}

type SwitchProps = {
  /**
   * Accessible name when the visible `label` is absent because something
   * OUTSIDE the switch already carries it — a grid's row and column headers,
   * say. Without it such a switch falls back to announcing `name`, which is a
   * machine key (`BOOK_REQUEST_FULFILLED:EMAIL`), not a name.
   */
  ariaLabel?: string;
  checked: boolean;
  description?: ReactNode;
  disabled?: boolean;
  label?: string;
  layout?: 'default' | 'horizontal';
  /**
   * A save driven by this switch is in flight. The thumb becomes a spinner
   * (after a short delay — see `SPINNER_DELAY_MS`) and further clicks are
   * ignored until it clears.
   *
   * Distinct from `disabled`, which means "you may not change this" and fades
   * the whole control. A loading switch keeps its colour and shows the
   * position it is SAVING, not the one it came from, so the reader can see
   * where the click is taking it.
   */
  loading?: boolean;
  name: string;
  onChange: (checked: boolean) => void;
  /**
   * The corner shape of the track, named for what the switch sits in. Defaults
   * to `inset` — concentric with the shaded input row every switch in this app
   * currently sits in. Pass `pill` for the classic capsule on an unshaded
   * surface.
   */
  radius?: SwitchRadiusValue;
};

export const Switch = ({
  ariaLabel,
  checked,
  description,
  disabled = false,
  label,
  layout = 'default',
  loading = false,
  name,
  onChange,
  radius = SwitchRadius.Inset as SwitchRadiusValue,
}: SwitchProps) => {
  const style = useStyle();
  const showSpinner = useDelayedFlag(loading, SPINNER_DELAY_MS);
  // Per-instance id so the description's aria target stays unique even when two
  // switches sharing a `name` mount at once (e.g. the device create + edit forms).
  const generatedId = useId();
  const descriptionId = description ? generatedId : undefined;

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!disabled && !loading) onChange(!checked);
    },
    [checked, disabled, loading, onChange]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled && !loading) onChange(!checked);
      }
    },
    [checked, disabled, loading, onChange]
  );

  // The description is helper text, not a toggle target — clicking it should
  // not flip the switch.
  const handleDescriptionClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  // The radius class lands on the track rather than the root because it styles
  // the track and its thumb, and the track is the one element both layouts
  // below render identically.
  const track = (
    <div
      className={cx(style.track, style[radius], {
        [style.checked]: checked,
        [style.disabled]: disabled,
        [style.loading]: showSpinner,
      })}
    >
      {showSpinner ? (
        // `aria-hidden` because `aria-busy` on the switch itself already
        // carries this to assistive tech, and from the undelayed prop.
        <SpinnerIcon aria-hidden={true} className={style.spinner} />
      ) : (
        <div className={style.thumb} />
      )}
    </div>
  );

  const descriptionEl = description ? (
    <div
      id={descriptionId}
      className={style.description}
      // In the horizontal layout the whole shaded row is a toggle target, so let
      // description clicks bubble up. Elsewhere the description stays inert helper text.
      onClick={layout === 'horizontal' ? undefined : handleDescriptionClick}
    >
      {description}
    </div>
  ) : null;

  const commonProps = {
    role: 'switch' as const,
    'aria-checked': checked,
    'aria-label': ariaLabel ?? label ?? name,
    'aria-describedby': descriptionId,
    'aria-disabled': disabled,
    'aria-busy': loading,
    tabIndex: disabled ? -1 : 0,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
  };

  // Horizontal keeps the toggle in its own right-hand column so the description,
  // stacked under the label in the content column, never runs beneath it.
  if (layout === 'horizontal') {
    return (
      <div {...commonProps} className={cx(style.root, style.horizontal)}>
        <div className={style.content}>
          {label && <span className={style.label}>{label}</span>}
          {descriptionEl}
        </div>
        {track}
      </div>
    );
  }

  return (
    <div {...commonProps} className={style.root}>
      <div className={style.row}>
        {track}
        {label && <span className={style.label}>{label}</span>}
      </div>
      {descriptionEl}
    </div>
  );
};
