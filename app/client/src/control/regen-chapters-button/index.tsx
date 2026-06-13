import { useCallback } from 'react';

import { useRegenChapters } from '~/provider/book';

import { Button } from '../button';

interface RegenChaptersButtonProps {
  bookId: string;
}

export function RegenChaptersButton({ bookId }: RegenChaptersButtonProps) {
  const [regenChapters, loading] = useRegenChapters();

  const handleClick = useCallback(() => {
    void regenChapters(bookId);
  }, [regenChapters, bookId]);

  return (
    <Button onClick={handleClick} loading={loading} disabled={loading}>
      Regen chapters
    </Button>
  );
}
