import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  heading: {
    flex: 1,
    margin: 0,
    fontSize: theme.fontSize.xl,
    color: theme.color.text.primary,
  },
  // The cards are laid out by Page's flex column and its gap. Wrapping them in a
  // <form> would collapse them into one flex item, dropping every gap between
  // them; `display: contents` keeps the form's semantics while letting the cards
  // stay direct flex items of the page — no gap value to duplicate here.
  form: {
    display: 'contents',
  },
  cardContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  // Purely a hook for the subjects prefetch handlers (`index.tsx`) — it must
  // generate NO box of its own, or it would become a second block between the
  // Subjects card body and `SubjectChips` and change that card's spacing.
  // `display: contents` keeps the DOM node (so React can dispatch
  // hover/focus to it) without laying it out.
  subjects: {
    display: 'contents',
  },
}));
