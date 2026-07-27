import { useCallback, useState } from 'react';

import { Card } from '../card';
import { useStyle } from './style';

interface Props {
  addFiles: (files: FileList) => void;
  multiple?: boolean;
  /** Noun used in "Drop {dropLabel} here or click to upload". */
  dropLabel?: string;
  /** Wrap the drop zone in a Card (default). Pass false to render it bare, e.g. inside a modal. */
  card?: boolean;
}

export const UploadZone = ({
  addFiles,
  multiple = true,
  dropLabel = 'books',
  card = true,
}: Props) => {
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

  const dropZone = (
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
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className={styles.dropText}>
        Drop {dropLabel} here or{' '}
        <label htmlFor="upload-file-input" className={styles.clickLabel}>
          click
        </label>{' '}
        to upload
      </div>
    </div>
  );

  return card ? <Card>{dropZone}</Card> : dropZone;
};
