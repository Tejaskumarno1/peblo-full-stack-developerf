import { useQuery } from '@tanstack/react-query';
import { notesAPI, todosAPI, hubAPI } from '../../api';

/** Counts and AI status shown in the Console and Soft Studio shells. */
export default function useShellData() {
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
    staleTime: 30 * 1000,
  });
  const { data: today } = useQuery({
    queryKey: ['todos', 'today', 'sidebar'],
    queryFn: () => todosAPI.getToday().then((r) => r.data),
    staleTime: 30 * 1000,
  });
  const { data: models } = useQuery({
    queryKey: ['hub-models'],
    queryFn: () => hubAPI.models().then((r) => r.data),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const openTasks = (today?.todayTasks?.length || 0) + (today?.overdueTasks?.length || 0);
  const local = models?.local;
  const cloudReady = (models?.cloud || []).filter((c) => c.configured);
  const routing = models?.routing || 'auto';

  let modelLine = 'no AI set up';
  let modelKind = 'off';
  if (local?.enabled && local.ok) { modelLine = `${local.chatModel} · local`; modelKind = 'local'; }
  else if (local?.enabled && !local.ok) { modelLine = 'ollama not running'; modelKind = 'warn'; }
  else if (cloudReady.length && routing !== 'ollama') { modelLine = `${cloudReady[0].model} · cloud`; modelKind = 'cloud'; }

  return { notesCount: notes.length, openTasks, modelLine, modelKind, routing };
}
