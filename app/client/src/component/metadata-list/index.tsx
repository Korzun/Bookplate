import { Metadata as MetadataComponent } from '../metadata';

import { useStyle } from './style';

export type Metadata = { title: string; value: string | React.ReactNode };
type MetadataListProps = { metadata: Metadata[] };
export const MetadataList = ({ metadata }: MetadataListProps) => {
  const styles = useStyle();
  const metadataElements = metadata.map(({ title, value }) => (
    <MetadataComponent key={title + value} title={title}>
      {value}
    </MetadataComponent>
  ));

  return <div className={styles.root}>{metadataElements}</div>;
};
