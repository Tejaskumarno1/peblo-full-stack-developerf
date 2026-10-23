// A repeating task is one series. Before deleting or editing one of its tasks, ask which ones the change is for.
// Resolves 'this' | 'following' | 'all', or null when the person cancels. A task that is not part of a series
// resolves 'this' straight away. The dialog itself is <SeriesScopeDialog /> (mounted once in the app shell).

export const SCOPE_EVENT = 'peblo:ask-scope';

export function askScope(task, verb = 'delete') {
  if (!task || !task.seriesId) return Promise.resolve('this');
  return new Promise((resolve) => {
    const e = new CustomEvent(SCOPE_EVENT, { detail: { verb, text: task.text, resolve } });
    window.dispatchEvent(e);
    // Nobody listening (should not happen): do not leave the caller hanging, and do not touch the series.
    if (!e.detail.handled) resolve(null);
  });
}
