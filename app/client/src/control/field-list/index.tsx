import { RowRemoveIcon } from '~/icon';

import { Button } from '../button';
import { NumberInput } from '../number-input';
import { TextInput } from '../text-input';
import { useStyle } from './style';

export type ColumnDescriptor =
  | { type: 'text'; key: string; placeholder?: string; validate?: (v: string) => boolean }
  | { type: 'number'; key: string; placeholder?: string; validate?: (v: string) => boolean };

export type FieldRow = { _key: string } & Record<string, string | number | undefined>;

type FieldListProps = {
  addLabel: string;
  columns: ColumnDescriptor[];
  onAdd: () => void;
  onChange: (rowKey: string, fieldKey: string, newValue: string | number | undefined) => void;
  onRemove: (rowKey: string) => void;
  onValidChange?: (fieldName: string, isValid: boolean) => void;
  rows: FieldRow[];
};

export const FieldList = ({
  addLabel,
  columns,
  onAdd,
  onChange,
  onRemove,
  onValidChange,
  rows,
}: FieldListProps) => {
  const style = useStyle();

  return (
    <div className={style.root}>
      <div className={style.rowContainer}>
        {rows.map((row) => (
          <div className={style.row} key={row._key}>
            <div className={style.fields}>
              {columns.map((col) => (
                <div className={style.field} key={col.key}>
                  {col.type === 'text' ? (
                    <TextInput
                      name={`${row._key}.${col.key}`}
                      placeholder={col.placeholder}
                      validate={col.validate}
                      value={row[col.key] !== undefined ? String(row[col.key]) : ''}
                      onChange={(newValue) => onChange(row._key, col.key, newValue)}
                      onValidChange={onValidChange}
                    />
                  ) : (
                    <NumberInput
                      label={undefined}
                      name={`${row._key}.${col.key}`}
                      placeholder={col.placeholder}
                      validate={col.validate}
                      value={
                        typeof row[col.key] === 'number' ? (row[col.key] as number) : undefined
                      }
                      onChange={(newValue) => onChange(row._key, col.key, newValue)}
                      onValidChange={onValidChange}
                    />
                  )}
                </div>
              ))}
            </div>
            <Button type="link" danger title="Remove row" onClick={() => onRemove(row._key)}>
              <RowRemoveIcon height={20} width={20} strokeWidth={2} />
            </Button>
          </div>
        ))}
      </div>
      <Button type="dashed" onClick={onAdd} radius="card">
        {addLabel}
      </Button>
    </div>
  );
};
