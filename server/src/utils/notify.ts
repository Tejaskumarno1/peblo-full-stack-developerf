// Tell the signed-in person's other windows/devices that their notes or tasks changed (PEB-77).
// Every write path calls this once, after the database change, so lists and the calendar refresh by themselves.
import type { Request } from 'express';

export type ChangeEvent = 'notes_changed' | 'todos_changed';

export function notify(req: Request | any, ...events: ChangeEvent[]) {
  try {
    const io = req.app?.get?.('io');
    const userId = req.user?.id;
    if (io && userId) for (const e of events) io.to(userId).emit(e);
  } catch {
    /* live refresh is best-effort; never fail the request because of it */
  }
}
