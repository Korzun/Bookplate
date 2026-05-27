import { useCallback } from 'react';

import { useIsAdmin } from '~/provider/auth';
import { useRegenChapters } from '~/provider/book';

import { Button } from '../button';

interface RegenChaptersButtonProps {
  bookId: string;
}

export function RegenChaptersButton({ bookId }: RegenChaptersButtonProps) {
  const [isAdmin] = useIsAdmin();
  const [regenChapters, loading] = useRegenChapters();

  const handleClick = useCallback(() => {
    void regenChapters(bookId);
  }, [regenChapters, bookId]);

  if (!isAdmin) {
    return null;
  }

  return (
    <Button onClick={handleClick} disabled={loading}>
      {loading ? 'Regenerating…' : 'Regen chapters'}
    </Button>
  );
}
