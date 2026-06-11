import { useCallback } from 'react';

import { Button } from '~/control/button';
import { useScanLibrary } from '~/provider/book';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

interface Props {
  disabled?: boolean;
}

export const LibraryScan = ({ disabled }: Props) => {
  const styles = useStyle();
  const [scanLibrary, , scanning] = useScanLibrary();
  const showToast = useToast();

  const handleScan = useCallback(async () => {
    const result = await scanLibrary();
    if (result === null) {
      showToast('Scan failed', 'error');
    } else {
      const changed = result.imported.length + result.removed.length;
      showToast(
        changed === 0
          ? 'Library already up to date'
          : `Scan complete: ${result.imported.length} imported, ${result.removed.length} removed`,
        'success'
      );
    }
  }, [scanLibrary, showToast]);

  return (
    <div className={styles.root}>
      <Button disabled={disabled} loading={scanning} onClick={handleScan}>
        {scanning ? 'Scanning…' : 'Library scan'}
      </Button>
    </div>
  );
};
