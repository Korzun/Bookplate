import { useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button } from '~/control';
import { CheckIcon } from '~/icon';

import { useStyle } from './style';

interface UrlRowProps {
  url: string;
}

const UrlRow = ({ url }: UrlRowProps) => {
  const styles = useStyle();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url]);

  return (
    <div className={styles.pill}>
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

  return (
    <Card title="Connection URLs">
      <div className={styles.rows}>
        <UrlRow url={`${base}/sync`} />
        <UrlRow url={`${base}/opds`} />
      </div>
    </Card>
  );
};
