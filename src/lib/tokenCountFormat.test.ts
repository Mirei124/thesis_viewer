import { describe, expect, it } from 'vitest';
import { formatTokenCount } from './tokenCountFormat';

describe('compact token counts', () => {
  it('keeps small exact counts and uses decimal K/M with at most one fractional digit', () => {
    expect([0, 999, 1_000, 1_024, 1_250, 12_000, 1_000_000, 1_250_000].map(formatTokenCount))
      .toEqual(['0', '999', '1K', '1K', '1.3K', '12K', '1M', '1.3M']);
  });
  it('promotes the rounded K boundary to M', () => {
    expect(formatTokenCount(999_949)).toBe('999.9K');
    expect(formatTokenCount(999_950)).toBe('1M');
    expect(formatTokenCount(999_999)).toBe('1M');
  });
  it('does not present missing or invalid usage as zero', () => {
    for (const value of [undefined, null, -1, 1.2, NaN, Infinity, '1000', Number.MAX_SAFE_INTEGER + 1]) {
      expect(formatTokenCount(value)).toBe('—');
    }
  });
});
