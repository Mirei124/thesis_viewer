import { describe, expect, it } from 'vitest';

import { translationCacheKey } from './translationCache';

describe('translation cache key', () => {
  const input = { documentVersion: 'sha256:document', selectedText: 'Sentence.', neighborContext: 'Previous.', targetLanguage: 'Chinese' as const, model: 'model-a', promptVersion: 'translation-v2-context' };

  it('changes for every response-shaping field and never contains secrets', () => {
    expect(translationCacheKey(input)).toBe(translationCacheKey({ ...input }));
    expect(translationCacheKey({ ...input, model: 'model-b' })).not.toBe(translationCacheKey(input));
    expect(translationCacheKey(input)).not.toContain('Authorization');
  });
});
