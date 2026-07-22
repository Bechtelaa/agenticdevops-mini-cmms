/** Presentation formatters — no business logic, just rendering. */

/**
 * Parse a server datetime. The backend serializes UTC; SQLite-backed values
 * arrive without an offset suffix, so bare timestamps are read as UTC.
 */
export function parseServerDate(value: string): Date {
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasOffset ? value : `${value}Z`);
}

/** `2520 → "42m"`, `3900 → "1h 05m"`, multi-day → `"2d 3h"`. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 1) {
    return '<1m';
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return `${totalHours}h ${String(minutes).padStart(2, '0')}m`;
  }
  const days = Math.floor(totalHours / 24);
  return `${days}d ${totalHours % 24}h`;
}

/** Age of a server timestamp relative to now, in formatDuration style. */
export function formatAge(isoTimestamp: string, now: Date = new Date()): string {
  const elapsedSeconds =
    (now.getTime() - parseServerDate(isoTimestamp).getTime()) / 1000;
  return formatDuration(Math.max(elapsedSeconds, 0));
}

/** Compact local rendering of a server timestamp for tables. */
export function formatTimestamp(value: string): string {
  const date = parseServerDate(value);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
