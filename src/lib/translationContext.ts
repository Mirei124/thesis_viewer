import { normalizePdfTextItem, type PageExtraction } from './pdfPageBlocks';

export const TRANSLATION_PROMPT_VERSION = 'translation-v2-context';

export type TranslationSource = {
  text: string;
  neighborContext: string;
  expanded: boolean;
  degradation?: string;
};

type Sentence = { text: string; start: number; end: number };

const UNSAFE_BLOCK_FLAGS = new Set([
  'non-axis-aligned-transform',
  'empty-or-zero-size-rect',
  'normalized-whitespace',
  'normalized-soft-hyphen',
  'normalized-unicode-nfkc',
  'offset-map-ambiguous',
]);

function sentences(text: string): Sentence[] | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  const segments = new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text);
  const result: Sentence[] = [];
  for (const segment of segments) {
    const leading = segment.segment.length - segment.segment.trimStart().length;
    const trimmed = segment.segment.trim();
    if (trimmed) result.push({ text: trimmed, start: segment.index + leading, end: segment.index + leading + trimmed.length });
  }
  return result.length > 0 ? result : null;
}

function uniqueIndex(text: string, query: string): number | null {
  const first = text.indexOf(query);
  if (first < 0 || text.indexOf(query, first + query.length) >= 0) return null;
  return first;
}

/**
 * PDF.js item order is not page reading order.  We therefore never stitch
 * blocks: a sentence may be expanded only inside one clean, uniquely matching
 * text item.  Neighbor context follows the same rule.
 */
export function translationSourceForSelection(page: PageExtraction | undefined, selectedText: string): TranslationSource {
  const selected = normalizePdfTextItem(selectedText).normalizedText.trim();
  if (!page || page.status !== 'text' || !selected) {
    return { text: selectedText, neighborContext: '', expanded: false, degradation: 'Sentence expansion was unavailable because reliable same-page text is not ready.' };
  }
  const candidates = page.blocks
    .filter((block) => !block.qualityFlags.some((flag) => UNSAFE_BLOCK_FLAGS.has(flag)))
    .map((block) => ({ block, index: uniqueIndex(block.normalizedText, selected) }))
    .filter((candidate): candidate is { block: PageExtraction['blocks'][number]; index: number } => candidate.index !== null);
  if (candidates.length !== 1) {
    return { text: selectedText, neighborContext: '', expanded: false, degradation: 'Kept the original selection because same-page sentence boundaries could not be verified.' };
  }
  const { block, index } = candidates[0];
  const blockSentences = sentences(block.normalizedText);
  const selectedEnd = index + selected.length;
  const sentenceIndex = blockSentences?.findIndex((sentence) => index >= sentence.start && selectedEnd <= sentence.end) ?? -1;
  if (!blockSentences || sentenceIndex < 0) {
    return { text: selectedText, neighborContext: '', expanded: false, degradation: 'Kept the original selection because same-page sentence boundaries could not be verified.' };
  }
  const sentence = blockSentences[sentenceIndex];
  const before = blockSentences[sentenceIndex - 1];
  const after = blockSentences[sentenceIndex + 1];
  // Long neighboring items are commonly table cells or extraction artifacts;
  // omit them instead of silently truncating a supposed sentence.
  const neighbors = [before, after].filter((item): item is Sentence => Boolean(item) && Array.from(item.text).length <= 1_200);
  return {
    text: sentence.text,
    neighborContext: neighbors.map((item) => item.text).join('\n'),
    expanded: sentence.text !== selected,
  };
}
