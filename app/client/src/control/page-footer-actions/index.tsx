import { Button } from '../button';
import { useStyle } from './style';

export interface FooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  emphasis?: boolean;
  align?: 'leading' | 'trailing';
  submit?: boolean;
  form?: string;
}

interface PageFooterActionsProps {
  items: FooterAction[];
}

export function PageFooterActions({ items }: PageFooterActionsProps) {
  const styles = useStyle();
  const leading = items.filter((item) => item.align === 'leading');
  const trailing = items.filter((item) => item.align !== 'leading');

  // Key by position within the row, not by label: a label can change across
  // renders (e.g. Save → Saving…) or repeat, and keying on it would remount the
  // button — dropping focus and its loading state.
  const renderButton = (item: FooterAction, key: string) => (
    <Button
      key={key}
      onClick={item.onClick}
      disabled={item.disabled}
      loading={item.loading}
      danger={item.danger}
      type={item.emphasis ? 'primary' : 'default'}
      submit={item.submit}
      form={item.form}
    >
      {item.label}
    </Button>
  );

  return (
    <div className={styles.root}>
      {leading.map((item, i) => renderButton(item, `leading-${i}`))}
      <div className={styles.spacer} />
      {trailing.map((item, i) => renderButton(item, `trailing-${i}`))}
    </div>
  );
}
