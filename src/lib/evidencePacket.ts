import { locateEvidenceCandidate, type EvidenceCandidate, type EvidenceLedger, type EvidencePrecision, type EvidenceSlot } from './evidenceLedger';
import type { PageExtraction } from './pdfPageBlocks';
import type { EvidencePassage } from './evidencePassages';

/**
 * A request-local, model-visible source excerpt. It intentionally contains no
 * ledger ID, block ID, offsets, or warning array. `alias` is only meaningful
 * for the lifetime of the packet that created it.
 */
export type CompactEvidenceSource = {
  alias: string;
  slot: EvidenceSlot;
  section: string;
  excerpt: string;
  precision: EvidencePrecision;
  coverage: EvidenceLedger['coverage'];
};

export type EvidencePacketPurpose =
  | 'three_line'
  | 'problem_motivation'
  | 'method'
  | 'contributions'
  | 'relative_novelty'
  | 'experiments_ablations'
  | 'limitations';

/** Ordered, request-local stages for a detailed overview conversation. */
export type ProgressiveEvidenceStage = Exclude<EvidencePacketPurpose, 'three_line'>;

export const PROGRESSIVE_EVIDENCE_STAGES: readonly ProgressiveEvidenceStage[] = [
  'problem_motivation',
  'method',
  'contributions',
  'relative_novelty',
  'experiments_ablations',
  'limitations',
];

export type EvidencePacket = {
  purpose: EvidencePacketPurpose;
  coverage: EvidenceLedger['coverage'];
  /** App-computed, short coverage notes. They are not model-generated claims. */
  coverageHints: string[];
  sources: CompactEvidenceSource[];
};

export type EvidencePacketOptions = {
  purpose: EvidencePacketPurpose;
  /** A caller can override the conservative purpose defaults. */
  preferredSlots?: readonly EvidenceSlot[];
  maxCandidates?: number;
  maxExcerptChars?: number;
};

const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_EXCERPT_CHARS = 320;

const PURPOSE_SLOTS: Record<EvidencePacketPurpose, readonly EvidenceSlot[]> = {
  three_line: ['contribution', 'method_overview', 'method_step', 'main_result', 'relative_novelty'],
  problem_motivation: ['problem', 'motivation', 'relative_novelty'],
  method: ['method_overview', 'method_step'],
  contributions: ['contribution', 'method_overview', 'main_result'],
  relative_novelty: ['relative_novelty', 'contribution', 'method_overview'],
  experiments_ablations: ['main_result', 'ablation', 'experimental_setup', 'evaluation_scope'],
  limitations: ['author_limitation', 'evaluation_scope', 'ablation'],
};

const mappings = new WeakMap<EvidencePacket, Map<string, EvidenceCandidate>>();

type ProgressiveSource = EvidenceCandidate | EvidencePassage;

type ProgressiveSessionState = {
  ledger: EvidenceLedger;
  nextStageIndex: number;
  nextAlias: number;
  aliases: Map<string, ProgressiveSource>;
  sentEvidenceIds: Set<string>;
  sentQuoteKeys: Set<string>;
};

/**
 * Deliberately opaque, in-memory state for one user-initiated detailed
 * overview. A caller must create a new session for every such request.
 */
export type ProgressiveEvidenceSession = {
  coverage: EvidenceLedger['coverage'];
  coverageHints: string[];
};

/** The only newly-added model-visible evidence for one conversation stage. */
export type ProgressiveEvidenceIncrement = {
  stage: ProgressiveEvidenceStage;
  coverage: EvidenceLedger['coverage'];
  coverageHints: string[];
  sources: CompactEvidenceSource[];
  /** All aliases that have become legal to cite, in stable send order. */
  sentAliases: string[];
};

export type ProgressiveEvidenceSessionOptions = {
  /** Conservative per-stage limits; omitted values use the defaults below. */
  maxCandidatesByStage?: Partial<Record<ProgressiveEvidenceStage, number>>;
  maxExcerptChars?: number;
};

/**
 * Optional, caller-owned ordering for one stage. Candidates must be the
 * exact current-ledger objects (as returned by the local retrieval index), so
 * an accidental result from another PDF cannot become model-visible.
 */
export type ProgressiveEvidenceStageSelection = {
  orderedCandidates?: readonly EvidenceCandidate[];
  /** Joined local passages are preferred for detailed-overview requests. */
  orderedPassages?: readonly EvidencePassage[];
};

const DEFAULT_PROGRESSIVE_MAX_CANDIDATES: Record<ProgressiveEvidenceStage, number> = {
  problem_motivation: 4,
  method: 5,
  contributions: 4,
  relative_novelty: 4,
  experiments_ablations: 6,
  limitations: 4,
};

const progressiveSessions = new WeakMap<ProgressiveEvidenceSession, ProgressiveSessionState>();

function boundedPositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer.`);
  return result;
}

function truncateExcerpt(value: string, maxChars: number): string {
  const characters = Array.from(value.trim());
  if (characters.length <= maxChars) return characters.join('');
  if (maxChars === 1) return '…';
  return `${characters.slice(0, maxChars - 1).join('')}…`;
}

function coverageHints(ledger: EvidenceLedger): string[] {
  if (ledger.coverage === 'full-text') return ['All PDF pages yielded text; figures, tables, formulas, and reading order can still be incomplete.'];
  if (ledger.coverage === 'partial') return ['Some PDF pages did not yield text. Missing material is not evidence of an absent paper claim.'];
  return ['No reliable PDF text was extracted, so no source excerpts are available.'];
}

function rankCandidates(candidates: EvidenceCandidate[], preferredSlots: readonly EvidenceSlot[]): EvidenceCandidate[] {
  const slotRank = new Map(preferredSlots.map((slot, index) => [slot, index]));
  return candidates
    .map((candidate, sourceIndex) => ({ candidate, sourceIndex, rank: slotRank.get(candidate.slot) ?? preferredSlots.length }))
    .sort((left, right) => left.rank - right.rank || left.sourceIndex - right.sourceIndex)
    .map(({ candidate }) => candidate);
}

function normalizedHeading(value: string): string {
  return value.trim().replace(/^(?:\d+(?:\.\d+)*\.?\s+)?/, '').replace(/[.:]+$/, '').replace(/\s+/g, ' ').toLocaleLowerCase();
}

function quoteDedupeKey(candidate: EvidenceCandidate): string {
  return candidate.quote.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** The ledger deliberately retains headings; a compact prompt prefers body text. */
function isSectionHeadingCandidate(candidate: EvidenceCandidate): boolean {
  return candidate.section.confidence === 'automatic'
    && normalizedHeading(candidate.quote) === normalizedHeading(candidate.section.title);
}

function visibleTextLength(value: string): number {
  return Array.from(value).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

/**
 * PDF.js commonly exposes title pages as independent text items. They are not
 * useful fallback evidence for a scientific overview and, unlike section
 * headings, are not always identifiable from the extracted section list.
 */
function isFrontMatterOrFragment(candidate: EvidenceCandidate, candidates: readonly EvidenceCandidate[]): boolean {
  const text = candidate.quote.trim();
  const folded = text.toLocaleLowerCase();
  if (visibleTextLength(text) < 16 || /^[\p{P}\p{S}\d\s]+$/u.test(text)) return true;
  if (/\b(?:doi|arxiv)\s*[:/]|https?:\/\/|www\.|\S+@\S+/i.test(text)) return true;
  if (/\b(?:department|university|institute|laboratory|school|corresponding\s+author|e-?mail|affiliation)\b/i.test(text)) return true;
  // Typical author lists have several capitalized names but no sentence-level
  // predicate. Keep this deliberately narrow so ordinary prose is not lost.
  if (/^(?:[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})(?:\s*(?:,|;|and|&|\*)\s*(?:[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})){1,}$/u.test(text)) return true;
  const isFirstUnknownCandidate = candidates[0] === candidate && candidate.section.confidence === 'unknown';
  const hasRecognizedBodyAfter = candidates.slice(1).some((item) => /\b(?:abstract|introduction|background|methods?|approach|experiments?|results?)\b/i.test(item.section.title));
  // A first-page title is usually title-cased and lacks sentence punctuation;
  // this is only applied when a later body section was actually recognized.
  if (isFirstUnknownCandidate && hasRecognizedBodyAfter && !/[.!?。！？]$/.test(text) && /^[A-Z\p{Lu}]/u.test(text) && !/\b(?:we|our|this paper|we propose|we introduce)\b/i.test(folded)) return true;
  return false;
}

/**
 * Shared local admission rule for model-facing evidence and retrieval. This is
 * intentionally a quality filter, not a semantic classifier: callers must not
 * infer that a retained excerpt proves its section-derived slot.
 */
export function isModelEligibleCandidate(candidate: EvidenceCandidate, candidates: readonly EvidenceCandidate[]): boolean {
  return !isSectionHeadingCandidate(candidate) && !isFrontMatterOrFragment(candidate, candidates);
}

/**
 * Creates a bounded model-facing packet while retaining an in-memory mapping
 * to the original local candidates. The mapping is deliberately not exposed
 * through the packet object, preventing callers from accidentally serializing
 * opaque IDs or anchors into a model request.
 */
export function createEvidencePacket(ledger: EvidenceLedger, options: EvidencePacketOptions): EvidencePacket {
  const maxCandidates = boundedPositiveInteger(options.maxCandidates, DEFAULT_MAX_CANDIDATES, 'maxCandidates');
  const maxExcerptChars = boundedPositiveInteger(options.maxExcerptChars, DEFAULT_MAX_EXCERPT_CHARS, 'maxExcerptChars');
  const preferredSlots = options.preferredSlots ?? PURPOSE_SLOTS[options.purpose];
  const seenQuotes = new Set<string>();
  const selected: EvidenceCandidate[] = [];

  for (const candidate of rankCandidates(ledger.candidates, preferredSlots)) {
    if (!isModelEligibleCandidate(candidate, ledger.candidates)) continue;
    const dedupeKey = quoteDedupeKey(candidate);
    if (!dedupeKey || seenQuotes.has(dedupeKey)) continue;
    seenQuotes.add(dedupeKey);
    selected.push(candidate);
    if (selected.length === maxCandidates) break;
  }

  const packet: EvidencePacket = {
    purpose: options.purpose,
    coverage: ledger.coverage,
    coverageHints: coverageHints(ledger),
    sources: selected.map((candidate, index) => ({
      alias: `S${String(index + 1).padStart(2, '0')}`,
      slot: candidate.slot,
      section: candidate.section.title,
      excerpt: truncateExcerpt(candidate.quote, maxExcerptChars),
      precision: candidate.precision,
      coverage: candidate.coverage,
    })),
  };
  mappings.set(packet, new Map(packet.sources.map((source, index) => [source.alias, selected[index]])));
  return packet;
}

/**
 * Starts an isolated progressive-evidence session. Its E aliases never leave
 * this object, so a new user request cannot accidentally bind old sources.
 */
export function createProgressiveEvidenceSession(
  ledger: EvidenceLedger,
  options: ProgressiveEvidenceSessionOptions = {},
): ProgressiveEvidenceSession {
  const maxExcerptChars = boundedPositiveInteger(options.maxExcerptChars, DEFAULT_MAX_EXCERPT_CHARS, 'maxExcerptChars');
  for (const stage of PROGRESSIVE_EVIDENCE_STAGES) {
    boundedPositiveInteger(options.maxCandidatesByStage?.[stage], DEFAULT_PROGRESSIVE_MAX_CANDIDATES[stage], `maxCandidatesByStage.${stage}`);
  }
  const session: ProgressiveEvidenceSession = { coverage: ledger.coverage, coverageHints: coverageHints(ledger) };
  // Store validated options in state so the model-facing session remains free
  // of source anchors and cannot accidentally be JSON-stringified into a prompt.
  progressiveSessions.set(session, {
    ledger,
    nextStageIndex: 0,
    nextAlias: 1,
    aliases: new Map(),
    sentEvidenceIds: new Set(),
    sentQuoteKeys: new Set(),
  });
  progressiveSessionOptions.set(session, { maxCandidatesByStage: options.maxCandidatesByStage, maxExcerptChars });
  return session;
}

const progressiveSessionOptions = new WeakMap<ProgressiveEvidenceSession, Required<Pick<ProgressiveEvidenceSessionOptions, 'maxExcerptChars'>> & Pick<ProgressiveEvidenceSessionOptions, 'maxCandidatesByStage'>>();

/**
 * Adds only previously unsent, deduplicated excerpts for the next fixed stage.
 * The order guard makes an alias impossible to cite before the user message
 * that introduced it has been appended to the conversation.
 */
export function appendProgressiveEvidenceStage(
  session: ProgressiveEvidenceSession,
  stage: ProgressiveEvidenceStage,
  selection: ProgressiveEvidenceStageSelection = {},
): ProgressiveEvidenceIncrement {
  const state = progressiveSessions.get(session);
  const options = progressiveSessionOptions.get(session);
  if (!state || !options) throw new Error('The progressive evidence session is not available for this request.');
  if (PROGRESSIVE_EVIDENCE_STAGES[state.nextStageIndex] !== stage) {
    throw new Error('Progressive evidence stages must be appended once in the application-defined order.');
  }
  const maxCandidates = boundedPositiveInteger(options.maxCandidatesByStage?.[stage], DEFAULT_PROGRESSIVE_MAX_CANDIDATES[stage], `maxCandidatesByStage.${stage}`);
  const orderedCandidates = selection.orderedCandidates;
  const orderedPassages = selection.orderedPassages;
  if (orderedCandidates && orderedPassages) throw new Error('A progressive stage must select candidates or passages, not both.');
  if (orderedCandidates) {
    for (const candidate of orderedCandidates) {
      const current = state.ledger.candidates.find((item) => item.evidenceId === candidate.evidenceId);
      if (current !== candidate) throw new Error('A progressive stage candidate must belong to this exact current PDF ledger.');
      if (!isModelEligibleCandidate(candidate, state.ledger.candidates)) {
        throw new Error('A progressive stage candidate must be eligible readable body evidence.');
      }
    }
  }
  if (orderedPassages) {
    for (const passage of orderedPassages) for (const member of passage.members) {
      const current = state.ledger.candidates.find((item) => item.evidenceId === member.candidate.evidenceId);
      if (current !== member.candidate) throw new Error('A progressive stage passage must belong to this exact current PDF ledger.');
    }
  }
  const selected: ProgressiveSource[] = [];
  const candidates = orderedCandidates ?? rankCandidates(state.ledger.candidates, PURPOSE_SLOTS[stage]);
  const sourceItems: ProgressiveSource[] = orderedPassages ? [...orderedPassages] : [...candidates];
  for (const source of sourceItems) {
    const members = 'members' in source ? source.members.map((member) => member.candidate) : [source];
    const key = 'members' in source ? source.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : quoteDedupeKey(source);
    if (!key || state.sentQuoteKeys.has(key) || members.every((candidate) => state.sentEvidenceIds.has(candidate.evidenceId))) continue;
    // A passage was admitted by the conservative passage builder. Its short
    // bridge members may not pass the standalone-fragment rule, but are safe
    // here because they can never be exposed independently.
    if (!('members' in source) && members.some((candidate) => !isModelEligibleCandidate(candidate, state.ledger.candidates))) continue;
    selected.push(source);
    if (selected.length === maxCandidates) break;
  }
  const sources = selected.map((source) => {
    const alias = `E${String(state.nextAlias++).padStart(3, '0')}`;
    const members = 'members' in source ? source.members.map((member) => member.candidate) : [source];
    const primary = members[0];
    state.aliases.set(alias, source);
    for (const candidate of members) state.sentEvidenceIds.add(candidate.evidenceId);
    state.sentQuoteKeys.add('members' in source ? source.text.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : quoteDedupeKey(source));
    return {
      alias,
      slot: primary.slot,
      section: 'members' in source ? source.sectionTitle : primary.section.title,
      excerpt: truncateExcerpt('members' in source ? source.text : primary.quote, options.maxExcerptChars),
      precision: primary.precision,
      coverage: primary.coverage,
    };
  });
  state.nextStageIndex += 1;
  return {
    stage,
    coverage: state.ledger.coverage,
    coverageHints: coverageHints(state.ledger),
    sources,
    sentAliases: [...state.aliases.keys()],
  };
}

function verifyOriginalCandidate(candidate: EvidenceCandidate, ledger: EvidenceLedger, pages: PageExtraction[]): void {
  const current = ledger.candidates.find((item) => item.evidenceId === candidate.evidenceId);
  const location = current && locateEvidenceCandidate(current, pages);
  const block = current && pages.flatMap((page) => page.blocks).find((item) => item.blockId === current.blockId);
  const precisionRank = { page: 0, block: 1, exact: 2 } as const;
  if (!current || !location || location.blockId !== current.blockId || precisionRank[location.precision] < precisionRank[current.precision] || !block) {
    throw new Error('A model source alias does not resolve to verifiable local evidence.');
  }
  if (block.normalizedText.slice(current.normalizedStart, current.normalizedEnd) !== current.quote) {
    throw new Error('A model source alias resolves to a local quote that no longer matches this PDF.');
  }
}

/**
 * Resolves aliases only within their originating packet, rejects duplicates,
 * and rechecks the original current-PDF anchor before returning candidates.
 */
export function resolveEvidencePacketAliases(
  packet: EvidencePacket,
  aliases: readonly string[],
  ledger: EvidenceLedger,
  pages: PageExtraction[],
): EvidenceCandidate[] {
  const mapping = mappings.get(packet);
  if (!mapping) throw new Error('The evidence packet is not available for local alias resolution.');
  if (new Set(aliases).size !== aliases.length) throw new Error('The model response repeated a packet source alias.');
  return aliases.map((alias) => {
    const candidate = mapping.get(alias);
    if (!candidate) throw new Error(`The model response referenced an unknown packet source alias: ${alias}.`);
    verifyOriginalCandidate(candidate, ledger, pages);
    return candidate;
  });
}

/**
 * Resolves only aliases already introduced by this session's earlier or
 * current increments. It performs the same current-PDF anchor revalidation as
 * packet-local aliases and rejects duplicates or any future/session-foreign ID.
 */
export function resolveProgressiveEvidenceAliases(
  session: ProgressiveEvidenceSession,
  aliases: readonly string[],
  ledger: EvidenceLedger,
  pages: PageExtraction[],
): EvidenceCandidate[] {
  const state = progressiveSessions.get(session);
  if (!state) throw new Error('The progressive evidence session is not available for local alias resolution.');
  if (state.ledger !== ledger || state.ledger.documentVersion !== ledger.documentVersion) {
    throw new Error('The progressive evidence session cannot be reused with a different PDF ledger.');
  }
  if (new Set(aliases).size !== aliases.length) throw new Error('The model response repeated a progressive source alias.');
  return aliases.flatMap((alias) => {
    const source = state.aliases.get(alias);
    if (!source) throw new Error(`The model response referenced a progressive source alias that has not been sent: ${alias}.`);
    const candidates = 'members' in source ? source.members.map((member) => member.candidate) : [source];
    for (const candidate of candidates) verifyOriginalCandidate(candidate, ledger, pages);
    return candidates;
  });
}
