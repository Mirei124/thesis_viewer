import type { EvidenceCandidate } from './evidenceLedger';

function normalizedHeading(value: string): string {
  return value.trim().replace(/^(?:\d+(?:\.\d+)*\.?\s+)?/, '').replace(/[.:]+$/, '').replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isSectionHeadingCandidate(candidate: EvidenceCandidate): boolean {
  return candidate.section.confidence === 'automatic'
    && normalizedHeading(candidate.quote) === normalizedHeading(candidate.section.title);
}

function visibleTextLength(value: string): number {
  return Array.from(value).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function isFrontMatterOrFragment(candidate: EvidenceCandidate, candidates: readonly EvidenceCandidate[]): boolean {
  const text = candidate.quote.trim();
  const folded = text.toLocaleLowerCase();
  if (visibleTextLength(text) < 16 || /^[\p{P}\p{S}\d\s]+$/u.test(text)) return true;
  if (/\b(?:doi|arxiv)\s*[:/]|https?:\/\/|www\.|\S+@\S+/i.test(text)) return true;
  if (/\b(?:department|university|institute|laboratory|school|corresponding\s+author|e-?mail|affiliation)\b/i.test(text)) return true;
  if (/^(?:[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})(?:\s*(?:,|;|and|&|\*)\s*(?:[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})){1,}$/u.test(text)) return true;
  const isFirstUnknownCandidate = candidates[0] === candidate && candidate.section.confidence === 'unknown';
  const hasRecognizedBodyAfter = candidates.slice(1).some((item) => /\b(?:abstract|introduction|background|methods?|approach|experiments?|results?)\b/i.test(item.section.title));
  if (isFirstUnknownCandidate && hasRecognizedBodyAfter && !/[.!?。！？]$/.test(text) && /^[A-Z\p{Lu}]/u.test(text) && !/\b(?:we|our|this paper|we propose|we introduce)\b/i.test(folded)) return true;
  return false;
}

/** Shared admission rule, kept separate from packet construction to avoid a
 * runtime cycle between passage joining and source packet construction. */
export function isModelEligibleCandidate(candidate: EvidenceCandidate, candidates: readonly EvidenceCandidate[]): boolean {
  return !isSectionHeadingCandidate(candidate) && !isFrontMatterOrFragment(candidate, candidates);
}
