import { describe, expect, it } from 'vitest';

import { translationJobForStorage, type StoredTranslationJob } from './translationJobRepository';

describe('translation-job durable contract', () => {
  const job: StoredTranslationJob = {
    jobId: 'job-1', documentVersion: 'sha256:pdf', stage: 'success', readerSessionId: 'reader-1',
    selectedText: 'Selected sentence.', neighborContext: 'Neighboring context.', targetLanguage: 'Chinese',
    model: 'test-model', promptVersion: 'translation-v2-context', result: { translation: '译文。', uncertainty: null },
    createdAt: 1, updatedAt: 2,
  };

  it('keeps the lifecycle/result contract but strips unlisted secrets', () => {
    const unsafe = { ...job, apiKey: 'secret', headers: { Authorization: 'Bearer secret' } };
    expect(translationJobForStorage(unsafe)).toEqual(job);
    expect(JSON.stringify(translationJobForStorage(unsafe))).not.toContain('secret');
  });

  it('does not retain a result after a non-success terminal state', () => {
    expect(translationJobForStorage({ ...job, stage: 'cancelled' }).result).toBeUndefined();
  });
});
