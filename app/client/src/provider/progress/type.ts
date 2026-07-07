export type ProgressList = Record<string, UserProgressList>;
export type UserProgressList = Record<string, Progress>;

export type Progress = {
  document: string;
  percentage: number;
  device?: string; // returned by GET /api/my/progress and GET /api/users/:username/progress (admin)
  timestamp?: number; // returned by GET /api/my/progress and GET /api/users/:username/progress (admin)
  currentChapter?: number;
};
