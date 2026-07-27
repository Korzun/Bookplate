import { useCallback, useEffect, useRef } from 'react';

import { Button } from '~/control';
import { useScanLibrary } from '~/provider/book';
import { useToast } from '~/provider/toast';

import { Card } from '../card';

export const ScanLibrarySetting = () => {
  const [scanLibrary, , scanning] = useScanLibrary();
  const showToast = useToast();

  // scanLibrary resolves null for both a real failure and a cancellation (it
  // only cancels on unmount). Skip the result toast if we've unmounted so
  // navigating away mid-scan doesn't fire a false "Scan failed" on the next page.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const handleScan = useCallback(async () => {
    showToast('Scanning library…', 'info');
    const result = await scanLibrary();
    if (!mountedRef.current) return;
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
    <Card
      title="Scan library"
      subTitle="Check the library folder for books added or removed outside Bookplate and sync the catalog."
    >
      <Button loading={scanning} onClick={() => void handleScan()}>
        Scan
      </Button>
    </Card>
  );
};
