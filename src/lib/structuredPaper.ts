import type { EvidenceLedger } from './evidenceLedger';
import type { EvidencePassage, EvidencePassageMember } from './evidencePassages';
import type { PageExtraction, PdfPageTextBlock } from './pdfPageBlocks';

export const STRUCTURED_PAPER_VERSION = 'structured-paper-v1';
export type SectionRole = 'intro' | 'method' | 'related' | 'experiments' | 'limitations' | 'conclusion' | 'appendix' | 'references' | 'unknown';
export type ParagraphKind = 'body' | 'heading' | 'caption' | 'table' | 'equation' | 'frontmatter' | 'contents';
export type StructuredParagraph = EvidencePassage & {
  paragraphId: string; sectionId: string; role: SectionRole; kind: ParagraphKind; readOrder: number; column: number;
};
export type StructuredSection = {
  sectionId: string; title: string; role: SectionRole; level: number; parentId?: string;
  children: string[]; paragraphIds: string[]; startPage: number; endPage: number;
};
export type StructuredPaper = {
  version: typeof STRUCTURED_PAPER_VERSION; documentVersion: string; paragraphs: StructuredParagraph[];
  sections: StructuredSection[]; coverage: EvidenceLedger['coverage']; diagnostics: string[];
  unrepresentedBlockCount: number;
};
type Line = { blocks: PdfPageTextBlock[]; text: string; x: number; right: number; y: number; size: number; column: number };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 10;
const sizeOf = (b: PdfPageTextBlock) => Math.hypot(b.rawTransform[0], b.rawTransform[1]) || b.rawHeight || 10;
function roleFor(title: string): SectionRole {
  if (/\b(references|bibliography)\b/i.test(title)) return 'references';
  if (/\bappendi(?:x|ces)\b/i.test(title)) return 'appendix';
  if (/\b(related|prior)\s+works?\b/i.test(title)) return 'related';
  if (/\b(introduction|motivation|background)\b/i.test(title)) return 'intro';
  if (/\b(limitations?|discussions?|broader impacts?)\b/i.test(title)) return 'limitations';
  if (/\bconclusions?\b/i.test(title)) return 'conclusion';
  if (/\b(method\w*|approach\w*|architectures?|model|framework|representation|optimization|training|implementation|construction|collection|annotation|curation|protocol|preliminaries|formulation|problem statement|residual learning|task|setup|settings|scaling laws|data engine|overview|rasteriz\w*|splatting|attention)\b/i.test(title)) return 'method';
  if (/\b(experiment\w*|evaluation|results?|ablation\w*|benchmark\w*)\b/i.test(title)) return 'experiments';
  return 'unknown';
}
function linesFor(page: PageExtraction): Line[] {
  const blocks = page.blocks.filter(b => b.normalizedText.trim() && !b.qualityFlags.includes('non-axis-aligned-transform') && !b.qualityFlags.includes('empty-or-zero-size-rect'));
  const size = median(blocks.filter(b => b.normalizedText.length > 25).map(sizeOf));
  const left = Math.min(...blocks.map(b => b.rawTransform[4]));
  const right = Math.max(...blocks.map(b => b.rawTransform[4] + b.rawWidth));
  const middle = (left + right) / 2;
  // A gutter must be supported by multiple real prose lines on both sides.
  const long = blocks.filter(b => b.normalizedText.length >= 35);
  const leftCount = long.filter(b => b.rawTransform[4] < middle - size * 3 && b.rawTransform[4] + b.rawWidth < middle + size).length;
  const rightCount = long.filter(b => b.rawTransform[4] > middle - size && b.rawTransform[4] < middle + size * 5).length;
  const twoColumns = leftCount >= 5 && rightCount >= 5;
  const lines: Line[] = [];
  for (const b of [...blocks].sort((a, c) => c.rawTransform[5] - a.rawTransform[5] || a.rawTransform[4] - c.rawTransform[4])) {
    const x = b.rawTransform[4], y = b.rawTransform[5];
    const column = twoColumns ? (x < middle && x + b.rawWidth > middle + size * 2 ? -1 : x >= middle - size ? 1 : 0) : 0;
    const line = lines.find(l => l.column === column && Math.abs(l.y - y) <= Math.min(l.size, sizeOf(b)) * 0.42);
    if (line) { line.blocks.push(b); line.x = Math.min(line.x, x); line.right = Math.max(line.right, x + b.rawWidth); }
    else lines.push({ blocks: [b], text: '', x, right: x + b.rawWidth, y, size: sizeOf(b), column });
  }
  for (const line of lines) {
    line.blocks.sort((a, b) => a.rawTransform[4] - b.rawTransform[4]);
    line.text = line.blocks.reduce((text, block, index) => {
      const previous = line.blocks[index - 1];
      const smallCapSuffix = previous && /[A-Z]$/.test(previous.normalizedText.trim()) && /^[A-Z]{2,}/.test(block.normalizedText.trim())
        && sizeOf(block) < sizeOf(previous) * 0.95
        && block.rawTransform[4] - (previous.rawTransform[4] + previous.rawWidth) < sizeOf(previous) * 0.2;
      return text + (text && !smallCapSuffix ? ' ' : '') + block.normalizedText.trim();
    }, '').replace(/([A-Z])\s*-\s*(?=[A-Z])/g, '$1-');
    line.size = median(line.blocks.map(sizeOf));
  }
  // Full-width lines divide a page into horizontal regions; columns are read within each region.
  const spans = lines.filter(l => l.column === -1).sort((a, b) => b.y - a.y);
  const result: Line[] = [];
  let ceiling = Infinity;
  for (const span of [...spans, undefined]) {
    const floor = span?.y ?? -Infinity;
    result.push(...lines.filter(l => l.column !== -1 && l.y < ceiling && l.y >= floor).sort((a, b) => a.column - b.column || b.y - a.y));
    if (span) result.push(span);
    ceiling = floor;
  }
  return result;
}
function headingLevel(line: Line, bodySize: number): number | undefined {
  const text = line.text.trim();
  if (text.length > 125 || /[!?;]\s+\w/.test(text) || /\.{3,}\s*\d+$/.test(text)) return;
  const numbered = /^(\d{1,2}(?:\.\d{1,2}){0,4}|[A-Z])\.?\s+([A-Z][\p{L}\d ,:&()/'’–−-]+)$/u.exec(text);
  if (numbered && !/^0(?:\.|$)/.test(numbered[1]) && !/^(?:Does|Did|Do|Is|Are|Was|Were|Will|Have|Has|What|How|If|Consider)\b/.test(numbered[2]) && (!/[,;]/.test(numbered[2]) || numbered[2] === numbered[2].toUpperCase()) && !/^[A-Z]$/.test(numbered[1]) && text.split(/\s+/).length <= 15 && !/^[\d .T−-]+$/.test(text)) return numbered[1].split('.').length;
  if (/^(?:abstract|references|bibliography|appendix|appendices|conclusions?|introduction|related work|limitations|acknowledg\w*)(?:\s+[A-Z])?$/i.test(text)) return 1;
  if (line.size > bodySize * 1.08 && text.length < 90 && text.split(/\s+/).length <= 8 && !/[,;]/.test(text) && /^[A-Z]/.test(text) && !/[.!?]$/.test(text) && roleFor(text) !== 'unknown') return 1;
}
function kindFor(line: Line): ParagraphKind {
  if (/^(?:figure|fig\.?|table|tab\.?|algorithm)\s*\d+\b/i.test(line.text)) return 'caption';
  if (/\.{3,}\s*\d+$/.test(line.text)) return 'contents';
  if (line.blocks.length > 5 && line.text.replace(/[\p{L}\s]/gu, '').length > line.text.length * 0.25 && /[=∝∑∈≈]/.test(line.text)) return 'equation';
  if (line.blocks.length >= 4 && line.blocks.filter(b => /^[-+\d.,%±]+$/.test(b.normalizedText.trim())).length >= 3) return 'table';
  return 'body';
}

/** Geometry changes reading context only. Original candidates and their quotes/offsets are never edited. */
export function createStructuredPaper(ledger: EvidenceLedger, pages: readonly PageExtraction[]): StructuredPaper {
  const byBlock = new Map(ledger.candidates.map(c => [c.blockId, c]));
  const paragraphs: StructuredParagraph[] = [], sections: StructuredSection[] = [];
  const diagnostics = ['Automatic geometry and section roles are context heuristics, not semantic verification.', 'Uncertain cross-column and cross-page continuations remain separate paragraphs.'];
  const root: StructuredSection = { sectionId: 'section:frontmatter', title: 'Front matter', role: 'unknown', level: 0, children: [], paragraphIds: [], startPage: 0, endPage: 0 };
  sections.push(root);
  let current = root;
  let supplementaryRegion = false;
  const stack: StructuredSection[] = [root];
  let unrepresentedBlockCount = 0;
  for (const page of [...pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const lines = linesFor(page);
    const bodySize = median(lines.filter(l => l.text.length > 45).map(l => l.size));
    const toc = lines.filter(l => /\.{3,}\s*\d+$/.test(l.text)).length >= 3 || lines.some(l => /^(?:table of )?contents$/i.test(l.text));
    let group: Line[] = [], groupKind: ParagraphKind = 'body';
    const flush = () => {
      if (!group.length) return;
      let text = '';
      const members: EvidencePassageMember[] = [];
      for (const line of group) for (const block of line.blocks) {
        const candidate = byBlock.get(block.blockId);
        if (!candidate) { unrepresentedBlockCount++; continue; }
        if (text) text += ' ';
        const textStart = text.length;
        text += candidate.quote;
        members.push({ candidate, textStart, textEnd: text.length });
      }
      if (members.length) {
        const paragraphId = `${ledger.documentVersion}:${STRUCTURED_PAPER_VERSION}:p${page.pageIndex}:${paragraphs.length}`;
        paragraphs.push({ paragraphId, passageId: paragraphId, pageIndex: page.pageIndex, sectionId: current.sectionId, sectionTitle: current.title,
          role: current.role, kind: groupKind, readOrder: paragraphs.length, column: group[0].column, text, members, diagnostics: [] });
        current.paragraphIds.push(paragraphId); current.endPage = page.pageIndex;
      }
      group = [];
    };
    for (const line of lines) {
      const supplementary = (current.role === 'references' || current.role === 'appendix') && /[A-Za-z]{3}/.test(line.text) && /^[A-Z](?:\.\d+)*\.?\s+[A-Z][\p{L} ,:&()/'’–-]{2,100}$/u.test(line.text);
      let level = toc ? undefined : supplementary ? (line.text.match(/^[A-Z](?:\.\d+)*/)?.[0].split('.').length ?? 1) : headingLevel(line, bodySize);
      if (current === root && page.pageIndex === 0 && !/^(?:\d|abstract$|introduction$)/i.test(line.text)) level = undefined;
      if (level !== undefined) {
        flush();
        while (stack.length > 1 && stack.at(-1)!.level >= level) stack.pop();
        const parent = stack.at(-1)!;
        let role = roleFor(line.text);
        if (role === 'unknown' && level > 1) role = parent.role;
        // Letter-numbered supplementary sections remain appendix material, with their title available for targeted selection.
        if (supplementary || supplementaryRegion && role !== 'references') role = 'appendix';
        if (role === 'references' || role === 'appendix') supplementaryRegion = true;
        current = { sectionId: `section:${sections.length}`, title: line.text, role, level, parentId: parent.sectionId,
          children: [], paragraphIds: [], startPage: page.pageIndex, endPage: page.pageIndex };
        parent.children.push(current.sectionId); sections.push(current); stack.push(current);
        group = [line]; groupKind = 'heading'; flush(); continue;
      }
      let kind = toc ? 'contents' as const : kindFor(line);
      if (current === root && kind === 'body') kind = 'frontmatter';
      const previous = group.at(-1);
      const lineGap = previous ? previous.y - line.y : 0;
      const paragraphBreak = previous && (line.column !== previous.column || kind !== groupKind || lineGap > bodySize * 1.65 || lineGap < 0
        || Math.abs(line.size - previous.size) > bodySize * 0.18
        || line.x - previous.x > bodySize * 0.65 && /[.!?]$/.test(previous.text)
        || previous.right < line.right - bodySize * 2.5 && /[.!?]$/.test(previous.text)
        || /^[•●]\s/.test(line.text));
      if (paragraphBreak) flush();
      if (!group.length) groupKind = kind;
      group.push(line);
    }
    flush();
  }
  if (unrepresentedBlockCount) diagnostics.push(`${unrepresentedBlockCount} reliable nonempty PDF blocks have no ledger candidate; chapter coverage is incomplete (including any ledger-excluded appendix).`);
  for (const section of [...sections].reverse()) {
    const parent = sections.find(s => s.sectionId === section.parentId);
    if (parent) parent.endPage = Math.max(parent.endPage, section.endPage);
  }
  return { version: STRUCTURED_PAPER_VERSION, documentVersion: ledger.documentVersion, paragraphs, sections, coverage: ledger.coverage, diagnostics, unrepresentedBlockCount };
}

/** Independent detailed-mode ledger. Existing evidence identities are preserved; reliable supplementary blocks get the same deterministic ID scheme. */
export function createDetailedEvidenceLedger(bodyLedger: EvidenceLedger, pages: readonly PageExtraction[]): EvidenceLedger {
  const existing = new Map(bodyLedger.candidates.map(candidate => [candidate.blockId, candidate]));
  const candidates = [...bodyLedger.candidates];
  for (const page of pages) for (const block of page.blocks) {
    if (existing.has(block.blockId) || !block.normalizedText.trim() || block.qualityFlags.includes('non-axis-aligned-transform') || block.qualityFlags.includes('empty-or-zero-size-rect')) continue;
    const quote = block.normalizedText.trim(), normalizedStart = block.normalizedText.indexOf(quote);
    candidates.push({ evidenceId: `${bodyLedger.documentVersion}:${bodyLedger.version}:p${block.pageIndex}:i${block.sourceOrder}`,
      blockId: block.blockId, quote, normalizedStart, normalizedEnd: normalizedStart + quote.length,
      precision: 'block', section: { title: 'Unknown', confidence: 'unknown' }, slot: 'unclassified_body', coverage: bodyLedger.coverage,
      qualityWarnings: ['pdfjs-source-order-not-reading-order', 'section-is-unknown', 'section-derived-slot-not-semantic-verification'] });
  }
  return { ...bodyLedger, candidates, diagnostics: [...bodyLedger.diagnostics, 'Detailed ledger includes reliable reference/appendix items; section-aware context planning must exclude references.'] };
}
