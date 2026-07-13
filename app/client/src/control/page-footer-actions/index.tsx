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
}

interface PageFooterActionsProps {
  items: FooterAction[];
}

export function PageFooterActions({ items }: PageFooterActionsProps) {
  const styles = useStyle();
  const leading = items.filter((item) => item.align === 'leading');
  const trailing = items.filter((item) => item.align !== 'leading');

  const renderButton = (item: FooterAction) => (
    <Button
      key={item.label}
      onClick={item.onClick}
      disabled={item.disabled}
      loading={item.loading}
      danger={item.danger}
      type={item.emphasis ? 'primary' : 'default'}
    >
      {item.label}
    </Button>
  );

  return (
    <div className={styles.root}>
      {leading.map(renderButton)}
      <div className={styles.spacer} />
      {trailing.map(renderButton)}
    </div>
  );
}
