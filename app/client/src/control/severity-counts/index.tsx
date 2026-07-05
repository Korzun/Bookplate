import cx from 'classnames';

import { isBlocking, orderSeverityCounts, SEVERITY_LABEL } from '~/lib/severity';
import type { Severity } from '~/lib/severity';

import { useStyle } from './style';

interface Props {
  counts: Record<Severity, number>;
}

export const SeverityCounts = ({ counts }: Props) => {
  const styles = useStyle();
  const entries = orderSeverityCounts(counts);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className={styles.root}>
      {entries.map(({ severity, count }) => (
        <span
          key={severity}
          className={cx(styles.chip, isBlocking(severity) ? styles.blocking : styles.muted)}
        >
          {count} {SEVERITY_LABEL[severity]}
        </span>
      ))}
    </div>
  );
};
