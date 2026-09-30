import { DEFAULT_PROGRESSIVE_MAX_CANDIDATES, PROGRESSIVE_EVIDENCE_STAGES,
  appendProgressiveEvidenceStage, createProgressiveEvidenceSession, resolveEvidencePacketAliases, resolveProgressiveEvidenceAliases,
  type ProgressiveEvidenceStage } from './evidencePacket';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { createEvidencePassages } from './evidencePassages';
import type { PageExtraction } from './pdfPageBlocks';
import { pdfSectionCandidatesFromPages } from './pdfSectionCandidates';
import { createPassageRetrievalIndex, selectRankedPassagesForPurpose } from './retrievalIndex';
import { threeLineEvidencePacket } from './threeLineOverview';

const EXCERPT_LIMIT = 1500;

export type OfflineEvidenceSource = {
  alias: string;
  section: string;
  excerpt: string;
  excerptChars: number;
  evidenceIds: string[];
};

export type OfflineEvidenceStage = {
  stage: ProgressiveEvidenceStage;
  sourceCount: number;
  sourceLimit: number;
  totalExcerptChars: number;
  legalAliasCount: number;
  sources: OfflineEvidenceSource[];
};

export type OfflineEvidenceReplay = {
  documentVersion: string;
  pageCount: number;
  coverage: 'full-text' | 'partial' | 'unreadable';
  sectionCandidateCount: number;
  ledgerCandidateCount: number;
  passageCount: number;
  threeLine: {
    sourceCount: number;
    sourceLimit: number;
    totalExcerptChars: number;
    sources: OfflineEvidenceSource[];
  };
  stages: OfflineEvidenceStage[];
};

/** Replays the reader's detailed evidence selection without a provider call. */
export function replayDetailedEvidenceFromPages(pages: PageExtraction[], documentVersion: string): OfflineEvidenceReplay {
  const sections = pdfSectionCandidatesFromPages(pages, documentVersion);
  const ledger = pdfEvidenceLedgerFromPages(pages, documentVersion, sections);
  const threeLinePacket = threeLineEvidencePacket(ledger, pages);
  const threeLineSources = threeLinePacket.sources.map((source): OfflineEvidenceSource => {
    const excerptChars = Array.from(source.excerpt).length;
    if (excerptChars > 600) throw new Error(`three_line/${source.alias}: excerpt budget exceeded.`);
    const originals = resolveEvidencePacketAliases(threeLinePacket, [source.alias], ledger, pages);
    if (!originals.length) throw new Error(`three_line/${source.alias}: no original evidence.`);
    return { alias: source.alias, section: source.section, excerpt: source.excerpt,
      excerptChars, evidenceIds: originals.map((item) => item.evidenceId) };
  });
  if (threeLineSources.length > 12) throw new Error('three_line: source budget exceeded.');
  const passages = createEvidencePassages(ledger, { targetChars: 520, maxChars: EXCERPT_LIMIT, pages });
  const index = createPassageRetrievalIndex(passages);
  const session = createProgressiveEvidenceSession(ledger, { maxExcerptChars: EXCERPT_LIMIT });
  const stages: OfflineEvidenceStage[] = [];

  for (const stage of PROGRESSIVE_EVIDENCE_STAGES) {
    const orderedPassages = selectRankedPassagesForPurpose(index, stage, {
      maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true,
    });
    const packet = appendProgressiveEvidenceStage(session, stage, { orderedPassages });
    const sourceLimit = DEFAULT_PROGRESSIVE_MAX_CANDIDATES[stage];
    if (packet.sources.length > sourceLimit) throw new Error(`${stage}: source budget exceeded.`);
    const sources = packet.sources.map((source): OfflineEvidenceSource => {
      const excerptChars = Array.from(source.excerpt).length;
      if (excerptChars > EXCERPT_LIMIT) throw new Error(`${stage}/${source.alias}: excerpt budget exceeded.`);
      // This rechecks the exact original quote and block anchor for every
      // member, including short items joined into one passage alias.
      const originals = resolveProgressiveEvidenceAliases(session, [source.alias], ledger, pages);
      if (!originals.length) throw new Error(`${stage}/${source.alias}: no original evidence.`);
      return { alias: source.alias, section: source.section, excerpt: source.excerpt,
        excerptChars, evidenceIds: originals.map((item) => item.evidenceId) };
    });
    stages.push({ stage, sourceCount: sources.length, sourceLimit,
      totalExcerptChars: sources.reduce((sum, source) => sum + source.excerptChars, 0),
      legalAliasCount: packet.sentAliases.length, sources });
  }

  return { documentVersion, pageCount: pages.length, coverage: ledger.coverage,
    sectionCandidateCount: sections.length, ledgerCandidateCount: ledger.candidates.length,
    passageCount: passages.passages.length,
    threeLine: { sourceCount: threeLineSources.length, sourceLimit: 12,
      totalExcerptChars: threeLineSources.reduce((sum, source) => sum + source.excerptChars, 0), sources: threeLineSources },
    stages };
}
