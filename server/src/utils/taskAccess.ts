/*
 * Who sees a task in a team. Personal tasks are the owner's. In a team a task is visible to everyone unless it was made for "just me" or for picked people:
 *   meta.visibility  nothing = the whole team, 'me' = the creator and the assignees, 'people' = those plus meta.viewers
 * The creator and every assignee always see it. meta.assignees lists all of them; assigneeId stays the first one so older code keeps working.
 */
export type TaskLike = { userId: string; spaceId?: string | null; assigneeId?: string | null; meta?: any };

export const assigneesOf = (t: TaskLike): string[] => {
  const list = Array.isArray(t.meta?.assignees) ? (t.meta.assignees as string[]) : [];
  return list.length ? list : t.assigneeId ? [t.assigneeId] : [];
};

export function taskVisible(t: TaskLike, userId: string): boolean {
  if (!t.spaceId) return true;
  const v = t.meta?.visibility;
  if (v !== 'me' && v !== 'people') return true;
  if (t.userId === userId || assigneesOf(t).includes(userId)) return true;
  return v === 'people' && Array.isArray(t.meta?.viewers) && t.meta.viewers.includes(userId);
}

/** The board column of a task: done wins, then the stored status, else To do. */
export const COLUMN_KEY = /^[a-z][a-z0-9_]{0,31}$/;
export function columnOf(t: { completed: boolean; meta?: any }): string {
  if (t.completed) return 'done';
  const s = t.meta?.status;
  return typeof s === 'string' && COLUMN_KEY.test(s) && s !== 'todo' && s !== 'done' ? s : 'todo';
}

/** Moves a task to a column: the completed flag and meta.status stay in step. Returns the data and meta to save. */
export function moveToColumn(col: string, meta: any): { completed: boolean; meta: any } {
  const m = { ...(meta || {}) };
  if (col !== 'todo' && col !== 'done' && COLUMN_KEY.test(col)) m.status = col; else delete m.status;
  return { completed: col === 'done', meta: m };
}
