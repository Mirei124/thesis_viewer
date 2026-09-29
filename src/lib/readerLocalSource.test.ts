import { describe, expect, it } from 'vitest';

import { isLocalPdfSourceKey, localPdfSourceKey, sha256Hex } from './readerLocalSource';

describe('local PDF source key', () => {
  it('uses a stable SHA-256 digest of bytes alone', async () => {
    const first = new TextEncoder().encode('same PDF bytes');
    const second = new TextEncoder().encode('same PDF bytes');
    const key = localPdfSourceKey(await sha256Hex(first));
    expect(localPdfSourceKey(await sha256Hex(second))).toBe(key);
    expect(localPdfSourceKey(await sha256Hex(new TextEncoder().encode('different PDF bytes')))).not.toBe(key);
    expect(isLocalPdfSourceKey(key)).toBe(true);
  });

  it('rejects malformed local keys', () => {
    expect(isLocalPdfSourceKey('local-sha256-short')).toBe(false);
    expect(isLocalPdfSourceKey('https://example.org/paper.pdf')).toBe(false);
    expect(() => localPdfSourceKey('not-a-digest')).toThrow();
  });
});
