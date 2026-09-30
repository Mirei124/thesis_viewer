/** Local-only binding produced after source aliases have passed anchor validation. */
export type VerifiedEvidenceRef = { alias: string; evidenceIds: string[] };

export type InlineEvidencePart =
  | { kind: 'text'; value: string }
  | { kind: 'source'; alias: string; evidenceIds: string[] };

type SourcePart = Extract<InlineEvidencePart, { kind: 'source' }>;

/** Display only; the original verified alias remains the interaction's identity. */
export function inlineEvidenceLabel(part: SourcePart): string {
  const match = /^[ES](\d+)$/.exec(part.alias);
  const number = match ? String(Number(match[1])) : part.alias;
  return `[${number}]`;
}

export function inlineEvidenceAccessibleName(part: SourcePart, pageIndex: number, precision: 'exact' | 'block' | 'page', member?: number): string {
  const category = part.alias.startsWith('E') ? 'Detailed overview source' : 'Three-line overview source';
  const memberLabel = member && part.evidenceIds.length > 1 ? `, passage part ${member} of ${part.evidenceIds.length}` : '';
  return `Go to ${category} ${part.alias}${memberLabel} on page ${pageIndex + 1}; ${precision} precision`;
}

/** Keeps unknown mentions as ordinary text, then appends any verified but unmentioned sources. */
export function inlineEvidenceParts(text: string, refs: readonly VerifiedEvidenceRef[]): InlineEvidencePart[] {
  const bound = new Map(refs.filter((ref) => ref.evidenceIds.length > 0).map((ref) => [ref.alias, [...new Set(ref.evidenceIds)]]));
  const mentioned = new Set<string>();
  const seenInSentence = new Set<string>();
  const parts: InlineEvidencePart[] = [];
  const appendSource = (alias: string, evidenceIds: readonly string[]) => {
    parts.push({ kind: 'source', alias, evidenceIds: [...evidenceIds] });
  };
  const appendText = (value: string) => {
    if (value) parts.push({ kind: 'text', value });
    if (/[。！？.!?\n]/.test(value)) seenInSentence.clear();
  };
  const pattern = /\[(E\d{3}|S\d{2})\]|\b(E\d{3}|S\d{2})\b/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) appendText(text.slice(cursor, index));
    const alias = match[1] ?? match[2];
    const evidenceIds = bound.get(alias);
    if (evidenceIds) {
      if (!seenInSentence.has(alias)) appendSource(alias, evidenceIds);
      seenInSentence.add(alias);
      mentioned.add(alias);
    } else appendText(match[0]);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) appendText(text.slice(cursor));
  for (const ref of refs) {
    const evidenceIds = bound.get(ref.alias);
    if (!evidenceIds || mentioned.has(ref.alias)) continue;
    parts.push({ kind: 'text', value: ' ' });
    appendSource(ref.alias, evidenceIds);
    mentioned.add(ref.alias);
  }
  return parts;
}
