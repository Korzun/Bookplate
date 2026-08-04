import { useCallback, useEffect, useRef } from 'react';

import { Button } from '~/control';
import { useScanLibrary } from '~/provider/book';
import { useToast } from '~/provider/toast';

import { Card } from '../card';

export const ScanLibrarySetting = () => {
  const [scanLibrary, scanResult, scanning, failed] = useScanLibrary();
  const showToast = useToast();

  // Completion now arrives asynchronously over the scan-progress subscription
  // rather than from scanLibrary()'s return value (which resolves void), and
  // the hook's terminal status stays populated indefinitely once a scan has
  // ever completed. Only toast for a scan THIS component instance started —
  // otherwise merely mounting on a library with a past completed/failed scan
  // would fire a toast with no user action.
  const startedRef = useRef(false);
  const reportedResultRef = useRef<typeof scanResult>(undefined);
  const reportedFailedRef = useRef(false);

  const handleScan = useCallback(() => {
    startedRef.current = true;
    reportedResultRef.current = undefined;
    reportedFailedRef.current = false;
    showToast('Scanning library…', 'info');
    void scanLibrary();
  }, [scanLibrary, showToast]);

  useEffect(() => {
    if (!startedRef.current) return;
    if (scanResult && scanResult !== reportedResultRef.current) {
      reportedResultRef.current = scanResult;
      const changed = scanResult.imported.length + scanResult.removed.length;
      showToast(
        changed === 0
          ? 'Library already up to date'
          : `Scan complete: ${scanResult.imported.length} imported, ${scanResult.removed.length} removed`,
        'success'
      );
    } else if (failed && !reportedFailedRef.current) {
      reportedFailedRef.current = true;
      showToast('Scan failed', 'error');
    }
  }, [scanResult, failed, showToast]);

  return (
    <Card
      title="Scan library"
      subTitle="Check the library folder for books added or removed outside Bookplate and sync the catalog."
    >
      <Button loading={scanning} onClick={handleScan}>
        Scan
      </Button>
    </Card>
  );
};
