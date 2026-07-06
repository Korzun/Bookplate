import cx from 'classnames';

import { isBlockingAtThreshold, orderSeverityCounts, SEVERITY_LABEL } from '~/lib/severity';
import type { Severity, ValidationThreshold } from '~/lib/severity';

import { useStyle } from './style';

interface Props {
  counts: Record<Severity, number>;
  threshold: ValidationThreshold;
}

export const SeverityCounts = ({ counts, threshold }: Props) => {
  const styles = useStyle();
  const entries = orderSeverityCounts(counts);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className={styles.root}>
      {entries.map(({ severity, count }) => {
        const blocking = isBlockingAtThreshold(severity, threshold);
        return (
          <span
            key={severity}
            data-blocking={blocking}
            className={cx(styles.chip, blocking ? styles.blocking : styles.muted)}
          >
            {count} {SEVERITY_LABEL[severity]}
          </span>
        );
      })}
    </div>
  );
};
