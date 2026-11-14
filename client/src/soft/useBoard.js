// The Kanban columns of the space being worked in (a team's shared board, or Personal's own).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { todosAPI } from '../api';
import { useCurrentSpace } from './spaces';

export const DEFAULT_COLUMNS = [
  { key: 'todo', name: 'To do', tone: 'sand' },
  { key: 'doing', name: 'In progress', tone: 'butter' },
  { key: 'review', name: 'In review', tone: 'lilac' },
  { key: 'done', name: 'Done', tone: 'mint' },
];
export const TONES = ['sand', 'butter', 'lilac', 'mint', 'sky', 'peach'];

export function useBoardColumns() {
  const space = useCurrentSpace();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['board', space || 'personal'], queryFn: () => todosAPI.board().then((r) => r.data), staleTime: 30000 });
  const save = async (columns) => {
    const r = await todosAPI.saveBoard(columns);
    qc.setQueryData(['board', space || 'personal'], r.data);
    return r.data;
  };
  return { columns: data?.columns || DEFAULT_COLUMNS, canEdit: data ? data.canEdit : true, loading: isLoading, save, space };
}

/** The column a task sits in on this board: done wins, then its status if the board has that column, else To do. */
export const columnFor = (t, keys) => (t.completed ? 'done' : keys.includes(t.meta?.status) && t.meta.status !== 'todo' && t.meta.status !== 'done' ? t.meta.status : 'todo');
