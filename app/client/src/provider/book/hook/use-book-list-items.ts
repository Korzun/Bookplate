import { useContext } from 'react';

import { Context } from '../context';
import type { DisplayUnit } from '../type';

export const useBookListItems = (): [DisplayUnit[], string | null] => {
  const { bookListItems, nextCursor } = useContext(Context);
  return [bookListItems, nextCursor];
};
