import { useApolloClient } from '@apollo/client/react';
import classNames from 'classnames';
import { type CSSProperties, useCallback } from 'react';

import { ChevronIcon, SpinnerIcon } from '~/icon';
import { PULL_THRESHOLD, usePullToRefresh } from '~/lib/use-pull-to-refresh';

import { useStyle } from './style';

/**
 * Pull-down-to-refresh for the installed app, where the browser's own gesture
 * is not available (iOS standalone has none; see `lib/is-standalone`).
 *
 * The refresh is Apollo's refetch of every ACTIVE query — everything mounted
 * on the current screen: the list, the detail card, nav badges, the library
 * switcher — straight from the network. The normalized cache is not cleared,
 * so nothing drops to a loading state; data updates in place. This is the
 * escape hatch for any mutation whose cache handling misses something, not a
 * substitute for getting that handling right.
 *
 * Mounted once, by `router/nav-layout`, only in standalone — the same gate as
 * `TopFade` — so it covers every nav-bearing page and is absent from the
 * password-reset screen. The gesture itself lives in `lib/use-pull-to-refresh`;
 * this component is the Apollo wiring plus the indicator.
 */
export const PullToRefresh = () => {
  const styles = useStyle();
  const client = useApolloClient();
  // A rejection (one of the refetches failed) is swallowed here on purpose:
  // the hook retracts the indicator either way, and the failing query already
  // reports its own error wherever it is rendered.
  const refresh = useCallback(
    () =>
      client.refetchQueries({ include: 'active' }).then(
        () => undefined,
        () => undefined
      ),
    [client]
  );
  const { phase, offset } = usePullToRefresh(refresh);

  const following = phase === 'pulling' || phase === 'armed';
  // The disc is moved by hand, by the overscroll the hook reports: fixed chrome
  // holds its place while the page rubber-bands on iOS (observed on-device,
  // 2026-10-28 — a disc left to the page's own motion never came out from
  // under the Dynamic Island), so the disc has to follow the pull itself, and
  // then stay where it is while a refresh runs after the page has snapped back.
  const vars = {
    '--pull-offset': `${offset}px`,
    '--pull-opacity': Math.min(1, offset / PULL_THRESHOLD),
  } as CSSProperties;

  return (
    <div className={styles.root} data-testid="pull-to-refresh">
      <div className={classNames(styles.disc, following && styles.following)} style={vars}>
        {phase === 'refreshing' ? (
          <SpinnerIcon role="status" aria-label="Refreshing" className={styles.spinner} />
        ) : (
          <ChevronIcon
            aria-hidden
            className={classNames(styles.arrow, phase === 'armed' && styles.arrowArmed)}
          />
        )}
      </div>
    </div>
  );
};
