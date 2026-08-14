export function formatClock(seconds: number): string {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.floor(Math.max(0, seconds) % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '∞';
  return formatClock(seconds);
}

export function formatTitleDuration(seconds: number | undefined | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return formatClock(seconds);
}
