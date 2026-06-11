import { useCallback, useState } from 'react';

import { Button } from '~/control/button';
import { useScanLibrary } from '~/provider/book';

import { Toast } from '../toast';

import { useStyle } from './style';

interface Props {
  disabled?: boolean;
}

export const LibraryScan = ({ disabled }: Props) => {
  const styles = useStyle();

  const [scanLibrary, scanResult, scanning, error] = useScanLibrary();
  const [scanCount, setScanCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);

  const handleScan = useCallback(() => {
    setScanCount((c) => c + 1);
    void scanLibrary();
  }, [scanLibrary]);
  const handleDismiss = useCallback(() => setDismissedCount(scanCount), [scanCount]);

  const toast = (() => {
    if (scanCount === 0 || dismissedCount >= scanCount || scanning) return null;
    if (error) return { message: 'Scan failed', type: 'error' as const };
    if (scanResult !== undefined) {
      const changed = scanResult.imported.length + scanResult.removed.length;
      return {
        message:
          changed === 0
            ? 'Library already up to date'
            : `Scan complete: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed`,
        type: 'success' as const,
      };
    }
    return null;
  })();

  return (
    <div className={styles.root}>
      <Button disabled={disabled} loading={scanning} onClick={handleScan}>
        {scanning ? 'Scanning…' : 'Library scan'}
      </Button>
      {toast && (
        <Toast
          key={scanCount}
          message={toast.message}
          type={toast.type}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  );
};
