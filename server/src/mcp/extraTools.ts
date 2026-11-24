/*
 * MCP 1.4.0: read-only tools that wrap GET routes the app already has (see docs/memory/09-mcp-gaps.md).
 * Every tool is a thin pass-through of the REST API, so the app's own rules (token scope, #private hiding, space membership) still apply.
 * Nothing here writes or deletes.
 */
import { z } from 'zod';

type Api = (method: string, path: string, body?: unknown, space?: string) => Promise<any>;
const enc = encodeURIComponent;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CAP = 60_000;

/** Raw answers can be huge (a whole account's activity): keep what fits, say so when something was cut. */
const trimmed = (v: unknown) => {
  const s = JSON.stringify(v, null, 2);
  return s.length <= CAP ? v : { truncated: true, note: `Answer cut at ${CAP} characters.`, text: s.slice(0, CAP) };
};

export function registerExtraTools(
  server: any,
  api: Api,
  spaceIdOf: (space?: string) => Promise<string | undefined>,
  run: (fn: () => Promise<unknown>) => Promise<any>,
  readOnly: Record<string, unknown>,
) {
  const SPACE = z.string().optional().describe('Team or office id or name from list_spaces; omit for Personal');
  const NEED_SPACE = z.string().describe('Team or office id or name from list_spaces');
  const needSpace = async (space: string) => {
    const id = await spaceIdOf(space);
    if (!id) throw new Error('Name a team or office (see list_spaces). Personal has no such data.');
    return id;
  };
  const tool = (name: string, description: string, inputSchema: Record<string, unknown>, fn: (a: any) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema, annotations: readOnly }, (a: any) => run(async () => trimmed(await fn(a ?? {}))));

  // ---- tasks and Kanban
  tool('list_board_columns', 'The Kanban columns of a team board (or Personal): key, name, order. Use with list_tasks all=true.', { space: SPACE },
    async ({ space }) => api('GET', '/todos/board', undefined, await spaceIdOf(space)));
  tool('get_task_thread', 'Read the discussion on a task: comments, mentions and review requests.', { id: z.string(), space: SPACE },
    async ({ id, space }) => api('GET', `/todos/${enc(id)}/thread`, undefined, await spaceIdOf(space)));
  tool('get_my_day', 'Everything on the person\'s plate today across Personal and every team they are in.', {},
    () => api('GET', '/workspaces/my-day'));
  tool('get_team_calendar', 'Team tasks and events between two dates (YYYY-MM-DD), across the teams the person is in.', { from: DATE, to: DATE, tz: z.string().optional().describe('IANA time zone, e.g. Asia/Kolkata') },
    ({ from, to, tz }: any) => api('GET', `/workspaces/team-range?from=${from}&to=${to}${tz ? '&tz=' + enc(tz) : ''}`));
  tool('get_team_workload', 'How many open tasks each person in a team has.', { space: NEED_SPACE },
    async ({ space }) => api('GET', `/workspaces/${enc(await needSpace(space))}/workload`));
  tool('list_team_projects', 'The projects (task groupings) of a team.', { space: NEED_SPACE },
    async ({ space }) => api('GET', `/workspaces/${enc(await needSpace(space))}/projects`));
  tool('list_task_templates', 'Saved task templates of a team.', { space: NEED_SPACE },
    async ({ space }) => api('GET', `/workspaces/${enc(await needSpace(space))}/templates`));

  // ---- notes
  tool('get_note_mentions', 'The notes this note mentions and the notes that mention it.', { id: z.string(), space: SPACE },
    async ({ id, space }) => api('GET', `/notes/${enc(id)}/mentions`, undefined, await spaceIdOf(space)));
  tool('get_note_version', 'Read one saved version of a note (ids come from list_note_history).', { id: z.string(), versionId: z.string() },
    ({ id, versionId }: any) => api('GET', `/notes/${enc(id)}/backups/${enc(versionId)}`));
  tool('get_trash_info', 'How many notes are in the trash and when they will be removed. Does not change the trash.', {},
    () => api('GET', '/notes/trash/info'));
  tool('list_note_comments', 'Comments on a note.', { note_id: z.string() },
    ({ note_id }: any) => api('GET', `/collab/comments/${enc(note_id)}`));
  tool('list_notifications', 'The person\'s notifications (mentions, comments, assignments). Does not mark them read.', {},
    () => api('GET', '/collab/notifications'));

  // ---- study, River, dashboard
  tool('get_study_mastery', 'How well the person knows each topic, from quizzes.', {}, () => api('GET', '/study/mastery'));
  tool('get_study_activity', 'Study activity over recent days.', {}, () => api('GET', '/study/activity'));
  tool('list_promises', 'Promises Peblo found in notes ("I will send it by Friday"), optionally for one note.', { note_id: z.string().optional() },
    ({ note_id }: any) => api('GET', '/river/promises' + (note_id ? `?noteId=${enc(note_id)}` : '')));
  tool('get_daily_briefing', 'Peblo\'s briefing for today.', {}, () => api('GET', '/dashboard/daily-briefing'));
  tool('get_weekly_report', 'Peblo\'s report on the past week.', {}, () => api('GET', '/dashboard/weekly-report'));
  tool('get_insights', 'Dashboard insights: streaks, completion, busiest days.', {}, () => api('GET', '/dashboard/insights'));

  // ---- files (calendar feeds and the profile stay sign-in only: the server blocks tokens from them)
  tool('search_media', 'Search pictures and files saved in Peblo by name or text.', { query: z.string().min(1) },
    ({ query }: any) => api('GET', `/media/search?q=${enc(query)}`));
  tool('get_media_text', 'The text Peblo read from a file or described from a picture.', { id: z.string() },
    ({ id }: any) => api('GET', `/media/${enc(id)}/text`));

  // ---- teams and people
  tool('get_team_feed', 'Recent activity in a team.', { space: NEED_SPACE },
    async ({ space }) => api('GET', `/workspaces/${enc(await needSpace(space))}/feed`));
  tool('list_announcements', 'Announcements posted to a team.', { space: NEED_SPACE },
    async ({ space }) => api('GET', `/workspaces/spaces/${enc(await needSpace(space))}/announcements`));
  tool('list_people', 'The people in a team (names and ids), so a task can be matched to who it is for.', { space: NEED_SPACE },
    async ({ space }) => api('GET', `/workspaces/spaces/${enc(await needSpace(space))}/people-lite`));
}
