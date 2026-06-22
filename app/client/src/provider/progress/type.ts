export type ProgressList = Record<string, UserProgressList>;
export type UserProgressList = Record<string, Progress>;

export type Progress = {
  document: string;
  percentage: number;
  device?: string; // present on GET /api/users/:username/progress (admin), absent on GET /api/my/progress
  timestamp?: number; // present on GET /api/users/:username/progress (admin), absent on GET /api/my/progress
  currentChapter?: number;
};
