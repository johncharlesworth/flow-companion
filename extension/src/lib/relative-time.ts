// "Saved 3 min ago" beside the version chip, from the record's LastModifiedDate.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatSavedAgo(isoDate: string, now: number = Date.now()): string {
  const then = Date.parse(isoDate);
  if (Number.isNaN(then)) return '';
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return 'Saved just now';
  if (elapsed < HOUR) return `Saved ${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `Saved ${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 2 * DAY) return 'Saved yesterday';
  if (elapsed < 14 * DAY) return `Saved ${Math.floor(elapsed / DAY)} days ago`;
  const date = new Date(then);
  return `Saved on ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
