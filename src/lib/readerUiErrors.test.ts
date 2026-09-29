import { describe, expect, it } from 'vitest';

import { message } from './i18n';
import { parseReaderSourceFragment } from './readerSourceFragment';
import { readerFragmentErrorKey, readerModelErrorKey } from './readerUiErrors';
import type { EvidencePrecision, EvidenceSlot } from './evidenceLedger';

describe('reader-owned error copy', () => {
  it.each([
    ['#bad=1', 'reader.fragment.invalid'],
    ['#page=2', 'reader.fragment.missingPdf'],
    ['#pdf=not-a-url', 'reader.fragment.incompleteUrl'],
    ['#pdf=http%3A%2F%2Fexample.org%2Fa.pdf', 'reader.fragment.httpsOnly'],
    ['#pdf=https%3A%2F%2Fexample.org%2Fa.pdf&page=0', 'reader.fragment.invalidPage'],
  ] as const)('localizes rejected fragment %s without exposing parser copy', (hash, expectedKey) => {
    const result = parseReaderSourceFragment(hash);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const key = readerFragmentErrorKey(result.message);
    expect(key).toBe(expectedKey);
    for (const locale of ['en', 'zh-CN'] as const) {
      expect(message(locale, key)).not.toBe(key);
      expect(message(locale, key)).toContain('PDF');
    }
  });

  it('maps model validation failures separately from unknown errors and never exposes exception details', () => {
    const invalid = new Error('The model response referenced an unknown packet source alias: SECRET.');
    expect(readerModelErrorKey(invalid, 'overview')).toBe('reader.error.overviewInvalidOutput');
    expect(readerModelErrorKey(new Error('The model response was not valid translation JSON.'), 'translation')).toBe('reader.error.translationInvalidOutput');
    expect(readerModelErrorKey(new Error('sensitive transport diagnostic'), 'overview')).toBe('reader.error.overviewFailed');
    expect(readerModelErrorKey(new Error('sensitive transport diagnostic'), 'translation')).toBe('reader.error.translationFailed');
    expect(message('en', readerModelErrorKey(invalid, 'overview'))).not.toContain('SECRET');
    expect(message('zh-CN', readerModelErrorKey(invalid, 'overview'))).not.toContain('SECRET');
  });

  it('has localized names for each evidence slot and precision used in debug and accessible links', () => {
    const slots: EvidenceSlot[] = ['problem', 'motivation', 'method_overview', 'method_step', 'contribution', 'relative_novelty', 'experimental_setup', 'main_result', 'ablation', 'author_limitation', 'evaluation_scope', 'unclassified_body'];
    const precisions: EvidencePrecision[] = ['exact', 'block', 'page'];
    for (const locale of ['en', 'zh-CN'] as const) {
      for (const slot of slots) expect(message(locale, `reader.evidence.slot.${slot}`)).not.toBe('');
      for (const precision of precisions) expect(message(locale, `reader.evidence.precision.${precision}`)).not.toBe('');
    }
  });
});
