import { use } from 'react';

import { Context } from '../context';
import type { DisplayUnit } from '../type';

export const useBookListItems = (): [DisplayUnit[], string | null] => {
  const { bookListItems, nextCursor } = use(Context);
  return [bookListItems, nextCursor];
};
