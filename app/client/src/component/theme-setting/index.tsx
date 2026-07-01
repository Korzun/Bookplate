import { SegmentedControl } from '~/control';
import { useThemeSetting } from '~/provider/theme';

import { Card } from '../card';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];

export const ThemeSetting = () => {
  const [setting, setSetting] = useThemeSetting();

  return (
    <Card title="Appearance">
      <SegmentedControl
        name="Appearance"
        value={setting}
        options={OPTIONS}
        onChange={(value) => setSetting(value as typeof setting)}
      />
    </Card>
  );
};
