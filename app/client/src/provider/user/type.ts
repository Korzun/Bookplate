export type UserList = Record<string, User>;

export type User = {
  username: string;
  progressCount: number;
};
