/** Local-only binding produced after source aliases have passed anchor validation. */
export type VerifiedEvidenceRef = { alias: string; evidenceIds: string[] };

export type InlineEvidencePart =
  | { kind: 'text'; value: string }
  | { kind: 'source'; alias: string; evidenceId: string; member: number; memberCount: number };

type SourcePart = Extract<InlineEvidencePart, { kind: 'source' }>;

/** Display only; the original verified alias remains the interaction's identity. */
export function inlineEvidenceLabel(part: SourcePart): string {
  const match = /^[ES](\d+)$/.exec(part.alias);
  const number = match ? String(Number(match[1])) : part.alias;
  return part.memberCount > 1 ? `[${number}.${part.member}]` : `[${number}]`;
}

export function inlineEvidenceAccessibleName(part: SourcePart, pageIndex: number, precision: 'exact' | 'block' | 'page'): string {
  const category = part.alias.startsWith('E') ? 'Detailed overview source' : 'Three-line overview source';
  const member = part.memberCount > 1 ? `, passage part ${part.member} of ${part.memberCount}` : '';
  return `Go to ${category} ${part.alias}${member} on page ${pageIndex + 1}; ${precision} precision`;
}

/** Keeps unknown mentions as ordinary text, then appends any verified but unmentioned sources. */
export function inlineEvidenceParts(text: string, refs: readonly VerifiedEvidenceRef[]): InlineEvidencePart[] {
  const bound = new Map(refs.filter((ref) => ref.evidenceIds.length > 0).map((ref) => [ref.alias, ref.evidenceIds]));
  const mentioned = new Set<string>();
  const parts: InlineEvidencePart[] = [];
  const appendSource = (alias: string, evidenceIds: readonly string[]) => {
    evidenceIds.forEach((evidenceId, index) => {
      if (index > 0) parts.push({ kind: 'text', value: ' ' });
      parts.push({ kind: 'source', alias, evidenceId, member: index + 1, memberCount: evidenceIds.length });
    });
  };
  const pattern = /\b(?:E\d{3}|S\d{2})\b/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) parts.push({ kind: 'text', value: text.slice(cursor, index) });
    const evidenceIds = bound.get(match[0]);
    if (evidenceIds) {
      appendSource(match[0], evidenceIds);
      mentioned.add(match[0]);
    } else parts.push({ kind: 'text', value: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) });
  for (const ref of refs) {
    const evidenceIds = bound.get(ref.alias);
    if (!evidenceIds || mentioned.has(ref.alias)) continue;
    parts.push({ kind: 'text', value: ' ' });
    appendSource(ref.alias, evidenceIds);
    mentioned.add(ref.alias);
  }
  return parts;
}
