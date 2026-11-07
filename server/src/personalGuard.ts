/*
 * Workspaces safety net. Notes and tasks that live in a Team or the Office carry a space_id; Personal ones have none.
 * Every older query in the app filters by user only, so without this a team note written by you would show up in your
 * Personal list, search, export and AI. This extension makes "Personal only" the default for Note and Todo: a query that
 * does not mention spaceId at all gets `spaceId: null` added. Code that works in a space passes spaceId explicitly.
 * (Raw SQL and nested relation reads are not covered; the few raw queries on notes are handled by hand.)
 */
const MODELS = new Set(['Note', 'Todo']);
const SCOPED_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany']);
const mentionsSpace = (where: any): boolean => {
  if (!where || typeof where !== 'object') return false;
  if ('spaceId' in where) return true;
  for (const k of ['AND', 'OR', 'NOT']) {
    const v = where[k];
    if (v && (Array.isArray(v) ? v : [v]).some(mentionsSpace)) return true;
  }
  return false;
};

export function withPersonalDefault<T extends { $extends: (x: any) => any }>(base: T): any {
  return base.$extends({
    name: 'peblo-personal-default',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: string; operation: string; args: any; query: (a: any) => Promise<any> }) {
          if (!MODELS.has(model) || !SCOPED_OPS.has(operation)) return query(args);
          const a = args ?? {};
          if (mentionsSpace(a.where)) return query(a);
          return query({ ...a, where: { ...(a.where ?? {}), spaceId: null } });
        },
      },
    },
  });
}
