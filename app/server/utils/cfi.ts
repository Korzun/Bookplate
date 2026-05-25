export function parseCfiSpineIndex(cfi: string): number | null {
  const match = /^EPUB_CFI\(\/6\/(\d+)/.exec(cfi);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (n < 2 || n % 2 !== 0) return null;
  return (n - 2) / 2;
}

export function spineIndexToChapter(spineIndex: number, chapterSpineMap: number[]): number | null {
  if (chapterSpineMap.length === 0) return null;
  let chapterIndex = -1;
  for (let i = 0; i < chapterSpineMap.length; i++) {
    if (chapterSpineMap[i] <= spineIndex) chapterIndex = i;
  }
  return chapterIndex >= 0 ? chapterIndex + 1 : null;
}
