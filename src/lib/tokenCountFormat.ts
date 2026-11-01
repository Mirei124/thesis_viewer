/** Token units use decimal K/M in every UI language; stored usage remains unchanged. */
export function formatTokenCount(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return '—';
  if (value < 1_000) return String(value);
  // Promote values that would round to 1000K rather than showing a misleading unit boundary.
  const unit = value >= 999_950 ? 1_000_000 : 1_000;
  const rounded = Math.round(value / (unit / 10)) / 10;
  return `${rounded}${unit === 1_000_000 ? 'M' : 'K'}`;
}
