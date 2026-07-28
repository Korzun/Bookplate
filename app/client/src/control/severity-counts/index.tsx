import cx from 'classnames';

import {
  isBlockingAtThreshold,
  isDangerSeverity,
  orderSeverityCounts,
  SEVERITY_LABEL,
} from '~/lib/severity';
import type { Severity, ValidationThreshold } from '~/lib/severity';

import { useStyle } from './style';

interface Props {
  counts: Record<Severity, number>;
  threshold: ValidationThreshold;
  // When set, the label is pluralized to match the count (e.g. "2 Errors").
  pluralize?: boolean;
}

export const SeverityCounts = ({ counts, threshold, pluralize = false }: Props) => {
  const styles = useStyle();
  const entries = orderSeverityCounts(counts);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className={styles.root}>
      {entries.map(({ severity, count }) => {
        const blocking = isBlockingAtThreshold(severity, threshold);
        const label =
          pluralize && count !== 1 ? `${SEVERITY_LABEL[severity]}s` : SEVERITY_LABEL[severity];
        return (
          <span
            key={severity}
            data-blocking={blocking}
            className={cx(styles.chip, isDangerSeverity(severity) ? styles.danger : styles.muted)}
          >
            {count} {label}
          </span>
        );
      })}
    </div>
  );
};
