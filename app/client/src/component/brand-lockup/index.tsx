import { BookplateCrestIcon } from '~/icon';
import { useLibraryName } from '~/provider/config';

import { useStyle } from './style';

// The default library name — its wordmark already lives inside the crest, so we
// hide the redundant title and let the logo speak for itself.
const DEFAULT_LIBRARY_NAME = 'bookplate';

// Frame dropped back so the octagon recedes and the monogram/wordmark stay
// luminous — the embossed "gallery" look. Reads on both light and dark themes
// because the crest inherits currentColor.
const FRAME_OPACITY = 0.4;

/**
 * The centered Bookplate crest lockup shared by the login and loading screens:
 * the ornate crest with a recessed frame, plus the library name below it unless
 * the name is the default (in which case the crest's own wordmark stands in).
 */
export const BrandLockup = () => {
  const styles = useStyle();
  const libraryName = useLibraryName();
  const showTitle = (libraryName ?? '').trim().toLowerCase() !== DEFAULT_LIBRARY_NAME;

  return (
    <div className={styles.root}>
      <BookplateCrestIcon
        className={styles.logo}
        width={176}
        height={176}
        frameOpacity={FRAME_OPACITY}
        {...(showTitle ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Bookplate' })}
      />
      {showTitle && <h1 className={styles.title}>{libraryName}</h1>}
    </div>
  );
};
