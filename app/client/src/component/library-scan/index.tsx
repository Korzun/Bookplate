import { useCallback, useEffect, useState } from 'react';

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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (scanning) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast(null);
      return;
    }
    if (error) {
      setToast({ message: 'Scan failed', type: 'error' });
      return;
    }
    if (scanResult !== undefined) {
      const changed = scanResult.imported.length + scanResult.removed.length;
      setToast({
        message:
          changed === 0
            ? 'Library already up to date'
            : `Scan complete: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed`,
        type: 'success',
      });
    }
  }, [scanning, error, scanResult]);

  const handleDismiss = useCallback(() => setToast(null), []);

  return (
    <div className={styles.root}>
      <Button disabled={disabled} loading={scanning} onClick={scanLibrary}>
        {scanning ? 'Scanning…' : 'Library scan'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={handleDismiss} />}
    </div>
  );
};
