import { EmojiIcon } from './emoji';
import { IconProps } from './props';

// Thumbs down 👎 (U+1F44E) as a currentColor silhouette; rating 1, Bad.
export const ThumbDownIcon = (props: IconProps) => <EmojiIcon glyph={'\u{1F44E}'} {...props} />;
