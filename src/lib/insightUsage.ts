import type { CompatibleUsage } from './compatibleProvider';

export type InsightUsageSummary = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  inputComplete: boolean;
  outputComplete: boolean;
  cacheHitRate?: number;
};

/** Counts only completed insight requests for which the provider returned a response. */
export function summarizeInsightUsage(usages: readonly (CompatibleUsage | undefined)[]): InsightUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheHitTokens = 0;
  let cacheMissTokens = 0;
  let inputComplete = true;
  let outputComplete = true;
  let cacheComplete = usages.length > 0;

  for (const usage of usages) {
    if (usage?.promptTokens === undefined) inputComplete = false;
    else inputTokens += usage.promptTokens;
    if (usage?.completionTokens === undefined) outputComplete = false;
    else outputTokens += usage.completionTokens;
    if (usage?.promptCacheHitTokens === undefined || usage.promptCacheMissTokens === undefined) cacheComplete = false;
    else {
      cacheHitTokens += usage.promptCacheHitTokens;
      cacheMissTokens += usage.promptCacheMissTokens;
    }
  }

  const cacheTotal = cacheHitTokens + cacheMissTokens;
  return {
    requestCount: usages.length,
    inputTokens,
    outputTokens,
    inputComplete,
    outputComplete,
    ...(cacheComplete && cacheTotal > 0 ? { cacheHitRate: Math.round((cacheHitTokens / cacheTotal) * 100) } : {}),
  };
}
