import { useStyle } from './style';

// Mobile-only scrim: a fixed frosted-glass layer at the top of the viewport that blurs
// scrolling content beneath the device status bar and fades out below it (Safari-style).
export const TopFade = () => {
  const styles = useStyle();
  return <div className={styles.root} aria-hidden="true" />;
};
