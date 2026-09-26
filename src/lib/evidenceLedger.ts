import { locateNormalizedRange, type PageExtraction, type PdfPageAnchor, type PdfPageTextBlock } from './pdfPageBlocks';
import type { PdfSectionCandidate } from './pdfSectionCandidates';

/** Local, pre-model evidence candidates. They are source excerpts, not claims. */
export const PDF_EVIDENCE_LEDGER_VERSION = 'pdf-evidence-ledger-v1';

export type EvidenceSlot =
  | 'problem' | 'motivation' | 'method_overview' | 'method_step'
  | 'contribution' | 'relative_novelty' | 'experimental_setup'
  | 'main_result' | 'ablation' | 'author_limitation' | 'evaluation_scope'
  | 'unclassified_body';

export type EvidencePrecision = 'exact' | 'block' | 'page';

export type EvidenceQualityWarning =
  | 'pdfjs-source-order-not-reading-order'
  | 'normalization-prevents-exact-offset'
  | 'section-is-automatic-candidate'
  | 'section-is-unknown'
  | 'section-derived-slot-not-semantic-verification'
  | 'partial-text-coverage'
  | 'unreadable-text-coverage'
  | 'quote-fallback-used'
  | 'block-id-not-found'
  | 'ambiguous-quote-on-page';

export type EvidenceSection = {
  title: string;
  confidence: 'automatic' | 'unknown';
};

export type EvidenceCandidate = {
  evidenceId: string;
  slot: EvidenceSlot;
  blockId: string;
  quote: string;
  normalizedStart: number;
  normalizedEnd: number;
  precision: EvidencePrecision;
  section: EvidenceSection;
  coverage: 'full-text' | 'partial' | 'unreadable';
  qualityWarnings: EvidenceQualityWarning[];
};

export type EvidenceLedger = {
  version: typeof PDF_EVIDENCE_LEDGER_VERSION;
  documentVersion: string;
  coverage: 'full-text' | 'partial' | 'unreadable';
  candidates: EvidenceCandidate[];
  excluded: { referencesBlockCount: number; unreliableBlockCount: number; emptyBlockCount: number };
  diagnostics: string[];
};

export type EvidenceLocation = {
  pageIndex: number;
  blockId?: string;
  normalizedStart?: number;
  normalizedEnd?: number;
  anchor?: PdfPageAnchor;
  precision: EvidencePrecision;
  qualityWarnings: EvidenceQualityWarning[];
};

type PositionedSection = PdfSectionCandidate & { sourceOrder: number };

const referencesHeading = /^(?:(?:\d+(?:\.\d+){0,5}\.?|[IVXLCDM]{1,8}\.)\s+)?(?:references|bibliography|bibliographical\s+references|literature\s+cited)\.?$/i;
const appendixHeading = /^(?:appendix|appendices)(?:\s|$)/i;

function documentCoverage(pages: PageExtraction[]): EvidenceLedger['coverage'] {
  const textPages = pages.filter((page) => page.status === 'text').length;
  if (textPages === 0) return 'unreadable';
  return textPages === pages.length ? 'full-text' : 'partial';
}

function sourceOrderForSection(section: PdfSectionCandidate, pages: PageExtraction[]): number {
  const page = pages.find((candidate) => candidate.pageIndex === section.pageIndex);
  const match = page?.blocks.find((block) => block.anchor === section.anchor || block.rawText === section.anchor.quote);
  return match?.sourceOrder ?? Number.MAX_SAFE_INTEGER;
}

function sectionForBlock(block: PdfPageTextBlock, sections: PositionedSection[]): EvidenceSection {
  let found: PositionedSection | undefined;
  for (const section of sections) {
    if (section.pageIndex < block.pageIndex || (section.pageIndex === block.pageIndex && section.sourceOrder <= block.sourceOrder)) found = section;
    else break;
  }
  return found
    ? { title: found.title, confidence: 'automatic' }
    : { title: 'Unknown', confidence: 'unknown' };
}

function slotForSection(section: EvidenceSection): EvidenceSlot {
  const title = section.title.toLocaleLowerCase();
  if (/\bablation\b/.test(title)) return 'ablation';
  if (/\b(?:limitation|limitations|discussion)\b/.test(title)) return 'author_limitation';
  if (/\b(?:experimental\s+setup|implementation\s+details|training\s+details|evaluation\s+setup)\b/.test(title)) return 'experimental_setup';
  if (/\b(?:experiments?|results?|evaluation)\b/.test(title)) return 'evaluation_scope';
  if (/\b(?:methods?|approach|model|framework)\b/.test(title)) return 'method_overview';
  if (/\b(?:introduction|background)\b/.test(title)) return 'problem';
  if (/\b(?:related\s+work|prior\s+work)\b/.test(title)) return 'relative_novelty';
  if (/\b(?:conclusion|contributions?)\b/.test(title)) return 'contribution';
  return 'unclassified_body';
}

function isUnreliable(block: PdfPageTextBlock): boolean {
  return block.qualityFlags.includes('non-axis-aligned-transform') || block.qualityFlags.includes('empty-or-zero-size-rect');
}

/**
 * Creates inspectable source excerpts only. Section names select a tentative
 * slot, but no local heuristic claims that an excerpt proves that slot.
 */
export function pdfEvidenceLedgerFromPages(
  pages: PageExtraction[], documentVersion: string, sections: PdfSectionCandidate[],
): EvidenceLedger {
  const coverage = documentCoverage(pages);
  const positionedSections = sections.map((section) => ({ ...section, sourceOrder: sourceOrderForSection(section, pages) }))
    .sort((left, right) => left.pageIndex - right.pageIndex || left.sourceOrder - right.sourceOrder);
  const flatBlocks = pages.flatMap((page) => page.blocks)
    .sort((left, right) => left.pageIndex - right.pageIndex || left.sourceOrder - right.sourceOrder);
  let referencesStarted = false;
  let referencesBlockCount = 0;
  let unreliableBlockCount = 0;
  let emptyBlockCount = 0;
  const candidates: EvidenceCandidate[] = [];

  for (const block of flatBlocks) {
    const normalized = block.normalizedText.trim();
    if (!normalized) { emptyBlockCount += 1; continue; }
    if (referencesHeading.test(normalized)) { referencesStarted = true; referencesBlockCount += 1; continue; }
    if (referencesStarted) { referencesBlockCount += 1; continue; }
    if (isUnreliable(block)) { unreliableBlockCount += 1; continue; }
    const section = sectionForBlock(block, positionedSections);
    // Appendix blocks need an explicit later inclusion decision; this initial
    // body ledger does not silently treat them as main-text evidence.
    if (appendixHeading.test(section.title)) { unreliableBlockCount += 1; continue; }
    const normalizedStart = block.normalizedText.indexOf(normalized);
    const normalizedEnd = normalizedStart + normalized.length;
    const location = locateNormalizedRange(block, normalizedStart, normalizedEnd);
    const precision: EvidencePrecision = location.precision === 'exact' ? 'exact' : location.precision === 'block' ? 'block' : 'page';
    const qualityWarnings: EvidenceQualityWarning[] = ['pdfjs-source-order-not-reading-order', 'section-derived-slot-not-semantic-verification'];
    if (precision !== 'exact') qualityWarnings.push('normalization-prevents-exact-offset');
    if (section.confidence === 'automatic') qualityWarnings.push('section-is-automatic-candidate');
    else qualityWarnings.push('section-is-unknown');
    if (coverage === 'partial') qualityWarnings.push('partial-text-coverage');
    if (coverage === 'unreadable') qualityWarnings.push('unreadable-text-coverage');
    candidates.push({
      evidenceId: `${documentVersion}:${PDF_EVIDENCE_LEDGER_VERSION}:p${block.pageIndex}:i${block.sourceOrder}`,
      slot: slotForSection(section), blockId: block.blockId, quote: normalized,
      normalizedStart, normalizedEnd, precision, section, coverage, qualityWarnings,
    });
  }
  const diagnostics = [
    `${candidates.length} local body excerpt candidate${candidates.length === 1 ? '' : 's'}; these are not model-generated facts.`,
    `${referencesBlockCount} References block${referencesBlockCount === 1 ? '' : 's'} and ${unreliableBlockCount} unreliable or Appendix block${unreliableBlockCount === 1 ? '' : 's'} were excluded.`,
    coverage === 'full-text' ? 'All PDF pages yielded text, but figures, tables, formulas, and reading order can still be unreliable.' : 'Text coverage is incomplete; missing text is retained as a coverage warning, not interpreted as an absent paper claim.',
  ];
  return { version: PDF_EVIDENCE_LEDGER_VERSION, documentVersion, coverage, candidates, excluded: { referencesBlockCount, unreliableBlockCount, emptyBlockCount }, diagnostics };
}

/** Resolves only against current local blocks; a quote fallback never upgrades precision. */
export function locateEvidenceCandidate(candidate: EvidenceCandidate, pages: PageExtraction[]): EvidenceLocation | undefined {
  const blocks = pages.flatMap((page) => page.blocks);
  const block = blocks.find((item) => item.blockId === candidate.blockId);
  if (block) {
    const quoteAtOffsets = block.normalizedText.slice(candidate.normalizedStart, candidate.normalizedEnd) === candidate.quote;
    if (quoteAtOffsets) {
      const mapped = locateNormalizedRange(block, candidate.normalizedStart, candidate.normalizedEnd);
      return {
        pageIndex: block.pageIndex, blockId: block.blockId, normalizedStart: candidate.normalizedStart, normalizedEnd: candidate.normalizedEnd,
        anchor: { ...block.anchor, quote: candidate.quote }, precision: mapped.precision === 'exact' ? 'exact' : 'block', qualityWarnings: candidate.qualityWarnings,
      };
    }
    return { pageIndex: block.pageIndex, blockId: block.blockId, anchor: block.anchor, precision: 'block', qualityWarnings: [...candidate.qualityWarnings, 'quote-fallback-used'] };
  }
  const matching = blocks.filter((item) => item.normalizedText.includes(candidate.quote));
  if (matching.length === 1) return { pageIndex: matching[0].pageIndex, blockId: matching[0].blockId, anchor: { ...matching[0].anchor, quote: candidate.quote }, precision: 'block', qualityWarnings: [...candidate.qualityWarnings, 'block-id-not-found', 'quote-fallback-used'] };
  if (matching.length > 1) return { pageIndex: matching[0].pageIndex, precision: 'page', qualityWarnings: [...candidate.qualityWarnings, 'block-id-not-found', 'ambiguous-quote-on-page'] };
  return undefined;
}
