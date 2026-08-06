import { use } from 'react';

import { Context } from '../context';
import type { DisplayUnit } from '../type';

export const useBookListItems = (): DisplayUnit[] => {
  const { bookListItems } = use(Context);
  return bookListItems;
};
