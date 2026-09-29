export type LocalPdfSourceKey = `local-sha256-${string}`;

export function isLocalPdfSourceKey(value: string): value is LocalPdfSourceKey {
  return /^local-sha256-[0-9a-f]{64}$/.test(value);
}

export function localPdfSourceKey(hashHex: string): LocalPdfSourceKey {
  const key = `local-sha256-${hashHex}`;
  if (!isLocalPdfSourceKey(key)) throw new Error('Invalid local PDF digest');
  return key;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}
