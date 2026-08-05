export type UserList = Record<string, User>;

export type User = {
  id: string;
  username: string;
  progressCount: number;
};
