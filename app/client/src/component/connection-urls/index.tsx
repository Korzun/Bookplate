import { type ComponentType, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button } from '~/control';
import { BooksIcon, CheckIcon, ClockIcon, type IconProps } from '~/icon';

import { useStyle } from './style';

interface UrlRowProps {
  label: string;
  url: string;
  icon: ComponentType<IconProps>;
}

const UrlRow = ({ label, url, icon: Icon }: UrlRowProps) => {
  const styles = useStyle();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url]);

  return (
    <div className={styles.pill}>
      <Icon className={styles.pillIcon} width={14} height={14} />
      <span className={styles.label}>{label}</span>
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
        <UrlRow label="Sync" url={`${base}/kosync`} icon={ClockIcon} />
        <UrlRow label="OPDS" url={`${base}/opds`} icon={BooksIcon} />
      </div>
    </Card>
  );
};
