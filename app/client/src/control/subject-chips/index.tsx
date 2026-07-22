import { ChipsInput } from '../chips-input';

type Props = {
  value: string[];
  suggestions: string[];
  onChange: (subjects: string[]) => void;
};

export const SubjectChips = ({ value, suggestions, onChange }: Props) => (
  <ChipsInput
    value={value}
    suggestions={suggestions}
    onChange={onChange}
    allowCustom
    placeholder="Add subject…"
    chipColor="subject"
  />
);
