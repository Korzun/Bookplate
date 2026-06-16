import { Select } from '~/control';
import { useLibrarySubjects } from '~/provider/book';
import type { BookListFilter } from '~/provider/book';

import { useStyle } from './style';

const TYPE_OPTIONS = [
  { label: 'Standalone', value: 'standalone' },
  { label: 'Series', value: 'series' },
];

const STATUS_OPTIONS = [
  { label: 'Not Started', value: 'not-started' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Completed', value: 'completed' },
];

interface FilterBarProps {
  filter: BookListFilter;
  onChange: (filter: BookListFilter) => void;
}

export function FilterBar({ filter, onChange }: FilterBarProps) {
  const style = useStyle();
  const [subjects, subjectsLoading, subjectsError] = useLibrarySubjects();
  if (subjectsError) console.error('Failed to load subjects:', subjectsError);
  return (
    <div className={style.root}>
      <Select
        layout="inline"
        name="type"
        options={TYPE_OPTIONS}
        placeholder="All Types"
        searchable={false}
        value={filter.type}
        onChange={(value) =>
          onChange({ ...filter, type: value as BookListFilter['type'] | undefined })
        }
      />
      <Select
        layout="inline"
        name="status"
        options={STATUS_OPTIONS}
        placeholder="All Statuses"
        searchable={false}
        value={filter.status}
        onChange={(value) =>
          onChange({ ...filter, status: value as BookListFilter['status'] | undefined })
        }
      />
      <Select
        layout="inline"
        name="subject"
        options={subjects}
        loading={subjectsLoading}
        placeholder="All Subjects"
        value={filter.subject}
        onChange={(value) => onChange({ ...filter, subject: value })}
      />
    </div>
  );
}
