import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button } from '~/control';
import { CheckIcon } from '~/icon';
import { useDeviceList } from '~/provider/device';

import { useStyle } from './style';

interface UrlRowProps {
  url: string;
  label?: string;
}

const UrlRow = ({ url, label }: UrlRowProps) => {
  const styles = useStyle();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url]);

  return (
    <div className={styles.pill}>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.url}>{url}</span>
      <Button
        type="default"
        success={copied}
        prefix={copied ? CheckIcon : undefined}
        onClick={handleCopy}
        radius="card"
      >
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  );
};

export const ConnectionUrls = () => {
  const styles = useStyle();
  const base = window.location.origin;
  const [devices] = useDeviceList();

  // The base library catalog plus one per-device catalog. Regular users need the
  // device URLs to point their e-readers at the right per-device edition. The base
  // catalog is only labelled "Default" once there is at least one device to
  // distinguish it from — with no devices it is simply the (single) library URL.
  const libraryUrls: UrlRowProps[] = [
    { url: `${base}/opds`, label: devices.length > 0 ? 'Default' : undefined },
    ...devices.map((device) => ({
      url: `${base}/opds/device/${device.slug}`,
      label: device.name,
    })),
  ];

  return (
    <Fragment>
      <Card title="Sync URL">
        <div className={styles.rows}>
          <UrlRow url={`${base}/sync`} />
        </div>
      </Card>
      <Card title={libraryUrls.length > 1 ? 'Library URLs' : 'Library URL'}>
        <div className={styles.rows}>
          {libraryUrls.map(({ url, label }) => (
            <UrlRow key={url} url={url} label={label} />
          ))}
        </div>
      </Card>
    </Fragment>
  );
};
