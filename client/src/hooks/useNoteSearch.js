import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notesAPI } from '../api';

/** Server-ranked note search (several words, small typos, best match first). `hits` is null until the answer arrives, so a list can show its own quick filter meanwhile. */
export default function useNoteSearch(q, params = {}) {
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq((q || '').trim()), 250); return () => clearTimeout(t); }, [q]);
  const key = JSON.stringify(params);
  const { data } = useQuery({
    queryKey: ['notes', 'find', dq, key],
    enabled: dq.length > 0,
    queryFn: () => notesAPI.getAll({ search: dq, snippet: '1', ...params }).then((r) => r.data.notes || []),
  });
  return { active: dq.length > 0, hits: dq.length > 0 && Array.isArray(data) ? data : null };
}
