import { useCallback, useState } from 'react';

import { Card } from '../card';
import { useStyle } from './style';

interface Props {
  addFiles: (files: FileList) => void;
}

export const UploadZone = ({ addFiles }: Props) => {
  const styles = useStyle();

  const [dragOver, setDragOver] = useState<boolean>(false);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      addFiles(event.dataTransfer.files);
    },
    [addFiles]
  );

  return (
    <Card>
      <div
        className={dragOver ? styles.dropZoneOver : styles.dropZone}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          id="upload-file-input"
          type="file"
          accept=".epub"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className={styles.dropText}>
          Drop books here or{' '}
          <label htmlFor="upload-file-input" className={styles.clickLabel}>
            click
          </label>{' '}
          to upload
        </div>
      </div>
    </Card>
  );
};
