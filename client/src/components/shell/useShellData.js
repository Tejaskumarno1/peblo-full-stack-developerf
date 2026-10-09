import { normalizeRouting, describeModel } from '../../utils/aiRouting';
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
  const routing = normalizeRouting(models?.routing);
  const desc = describeModel(models);
  const modelKind = desc.kind;
  const modelLine = desc.kind === 'local' ? `${desc.name} \u00b7 local` : desc.kind === 'cloud' ? `${desc.name} \u00b7 cloud` : desc.kind === 'warn' ? 'ollama not running' : 'no AI set up';

  return { notesCount: notes.length, openTasks, modelLine, modelKind, routing };
}
