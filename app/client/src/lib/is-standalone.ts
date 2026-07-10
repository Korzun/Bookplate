// Whether the app is running as an installed standalone PWA (added to the home screen)
// rather than in a browser tab. `navigator.standalone` is the reliable iOS Safari
// signal — the display-mode standalone check is unreliable on iOS — while the
// display-mode media query covers Android/desktop installs. Standalone status can't
// change during a session, so this is safe to read once at render time.
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
