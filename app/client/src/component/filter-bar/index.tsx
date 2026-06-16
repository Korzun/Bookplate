import { Select } from '~/control';
import { useLibrarySubjects } from '~/provider/book';
import type { BookListFilter } from '~/provider/book';

import { useStyle } from './style';

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
      <select
        aria-label="Filter by book type"
        className={style.select}
        value={filter.type ?? ''}
        onChange={(e) =>
          onChange({
            ...filter,
            type: e.target.value === '' ? undefined : (e.target.value as BookListFilter['type']),
          })
        }
      >
        <option value="">All Types</option>
        <option value="standalone">Standalone</option>
        <option value="series">Series</option>
      </select>
      <select
        aria-label="Filter by reading status"
        className={style.select}
        value={filter.status ?? ''}
        onChange={(e) =>
          onChange({
            ...filter,
            status:
              e.target.value === '' ? undefined : (e.target.value as BookListFilter['status']),
          })
        }
      >
        <option value="">All Statuses</option>
        <option value="not-started">Not Started</option>
        <option value="in-progress">In Progress</option>
        <option value="completed">Completed</option>
      </select>
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
