import { UserList } from '../type';

export const removeUserByUsername = (username: string, { [username]: _, ...rest }: UserList) =>
  rest;
