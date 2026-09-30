import { describe, expect, it } from 'vitest';
import { summarizeInsightUsage } from './insightUsage';

describe('summarizeInsightUsage', () => {
  it('adds three-line and detailed response counters and weights cache hits by tokens', () => {
    expect(summarizeInsightUsage([
      { promptTokens: 100, completionTokens: 20, promptCacheHitTokens: 0, promptCacheMissTokens: 100 },
      { promptTokens: 900, completionTokens: 40, promptCacheHitTokens: 800, promptCacheMissTokens: 100 },
    ])).toEqual({ requestCount: 2, inputTokens: 1000, outputTokens: 60, inputComplete: true, outputComplete: true, cacheHitRate: 80 });
  });

  it('marks partial provider accounting and withholds an incomplete cache ratio', () => {
    expect(summarizeInsightUsage([
      { promptTokens: 120, completionTokens: 10, promptCacheHitTokens: 80, promptCacheMissTokens: 40 },
      { promptTokens: 50 },
      undefined,
    ])).toEqual({ requestCount: 3, inputTokens: 170, outputTokens: 10, inputComplete: false, outputComplete: false });
  });

  it('does not turn absent or zero-denominator cache usage into a percentage', () => {
    expect(summarizeInsightUsage([])).toEqual({ requestCount: 0, inputTokens: 0, outputTokens: 0, inputComplete: true, outputComplete: true });
    expect(summarizeInsightUsage([{ promptTokens: 0, completionTokens: 0, promptCacheHitTokens: 0, promptCacheMissTokens: 0 }]).cacheHitRate).toBeUndefined();
  });
});
