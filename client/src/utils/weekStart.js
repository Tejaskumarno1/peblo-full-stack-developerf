// The first day of the week is one account setting (Settings -> Preferences), used by every screen and style.
// 'mon' (default) or 'sun'. It is read from the settings kept on this device (they mirror the account).

export function weekStartDay() {
  try { return JSON.parse(localStorage.getItem('peblo-settings') || '{}').weekStart === 'sun' ? 0 : 1; } catch { return 1; }
}

/** Midnight on the first day of the week that contains d. */
export function startOfWeek(d, first = weekStartDay()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() - first + 7) % 7));
  return x;
}

/** Weekday names in display order, e.g. ['Mon', ..., 'Sun']. */
export function weekdayNames(names, first = weekStartDay()) {
  return Array.from({ length: 7 }, (_, i) => names[(first + i) % 7]);
}

export const VALID_STYLES = ['studio', 'console', 'soft', 'river', 'orbit'];
