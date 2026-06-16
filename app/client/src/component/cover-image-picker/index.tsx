import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Card } from '~/component/card';
import { Button } from '~/control';
import { UploadIcon } from '~/icon';

import { useStyle } from './style';

interface Props {
  value: File | undefined;
  onChange: (file: File | undefined) => void;
}

export const CoverImagePicker = ({ value, onChange }: Props) => {
  const styles = useStyle();
  const inputRef = useRef<HTMLInputElement>(null);

  // useMemo instead of useEffect+setState avoids react-hooks/set-state-in-effect
  const thumbnailUrl = useMemo(() => (value ? URL.createObjectURL(value) : undefined), [value]);

  useEffect(() => {
    return () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  }, [thumbnailUrl]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.files?.[0] ?? undefined);
    },
    [onChange]
  );

  const handleChoose = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleClear = useCallback(() => {
    onChange(undefined);
    if (inputRef.current) inputRef.current.value = '';
  }, [onChange]);

  const sizeLabel = value ? `${(value.size / 1_048_576).toFixed(1)} MB` : '—';

  return (
    <Card title="Cover Image">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />
      <div className={styles.row}>
        <div className={styles.thumbSlot}>
          {thumbnailUrl ? (
            <img className={styles.thumb} src={thumbnailUrl} alt="" />
          ) : (
            <div className={styles.placeholderIcon}>
              <UploadIcon />
            </div>
          )}
        </div>
        {value ? (
          <div className={styles.filename}>{value.name}</div>
        ) : (
          <div className={styles.noFile}>No image selected</div>
        )}
        <div className={styles.size}>{sizeLabel}</div>
      </div>
      <div className={styles.actions}>
        <Button onClick={handleChoose}>{value ? 'Change…' : 'Choose image…'}</Button>
        {value && <Button onClick={handleClear}>Clear</Button>}
      </div>
    </Card>
  );
};
