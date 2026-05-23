import { UserList } from '../type';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const removeUserByUsername = (username: string, { [username]: _, ...rest }: UserList) =>
  rest;
