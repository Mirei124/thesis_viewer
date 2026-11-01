import { locateEvidenceCandidate, type EvidenceCandidate, type EvidenceLedger, type EvidencePrecision, type EvidenceSlot } from './evidenceLedger';
import type { PageExtraction } from './pdfPageBlocks';
import type { EvidencePassage } from './evidencePassages';
import { createEvidencePassages } from './evidencePassages';
import { isModelEligibleCandidate } from './evidenceEligibility';
export { isModelEligibleCandidate } from './evidenceEligibility';

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
  | 'contributions_novelty'
  | 'contributions'
  | 'relative_novelty'
  | 'experiments_ablations'
  | 'limitations';

/** Ordered, request-local stages for a detailed overview conversation. */
export type ProgressiveEvidenceStage = Exclude<EvidencePacketPurpose, 'three_line' | 'contributions' | 'relative_novelty'>;

export const PROGRESSIVE_EVIDENCE_STAGES: readonly ProgressiveEvidenceStage[] = [
  'problem_motivation',
  'method',
  'contributions_novelty',
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
  /** Original page blocks allow geometry-checked inline math reconstruction. */
  pages?: readonly PageExtraction[];
};

const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_EXCERPT_CHARS = 320;

const PURPOSE_SLOTS: Record<EvidencePacketPurpose, readonly EvidenceSlot[]> = {
  three_line: ['contribution', 'method_overview', 'method_step', 'main_result', 'relative_novelty'],
  problem_motivation: ['problem', 'motivation', 'relative_novelty'],
  method: ['method_overview', 'method_step'],
  contributions_novelty: ['contribution', 'relative_novelty', 'method_overview', 'main_result'],
  contributions: ['contribution', 'method_overview', 'main_result'],
  relative_novelty: ['relative_novelty', 'contribution', 'method_overview'],
  experiments_ablations: ['main_result', 'ablation', 'experimental_setup', 'evaluation_scope'],
  limitations: ['author_limitation', 'evaluation_scope', 'ablation'],
};

const mappings = new WeakMap<EvidencePacket, Map<string, EvidenceCandidate | EvidencePassage>>();

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

export const DEFAULT_PROGRESSIVE_MAX_CANDIDATES: Record<ProgressiveEvidenceStage, number> = {
  problem_motivation: 4,
  method: 5,
  contributions_novelty: 8,
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

type ThreeLineCategory = 'contribution' | 'method' | 'result';

function threeLineCategory(passage: EvidencePassage): ThreeLineCategory | undefined {
  const title = passage.sectionTitle;
  const text = passage.text;
  const intro = /\b(?:abstract|introduction|contributions?)\b|摘要|引言|贡献/i.test(title);
  const method = /\b(?:method|approach|architecture|construction|collection|annotation|dataset|benchmark|model|framework|training|data engine)\b|方法|架构|构建|采集|标注|数据|模型|训练/i.test(title);
  const experiment = /\b(?:experiments?|evaluation|results?|analysis|analyses|ablation)\b|实验|评测|结果|分析|消融/i.test(title);
  const contributionCue = /\bwe\s+(?:\w+ly\s+)?(?:introduce|present|propose|build|construct|curate|develop|design|provide|create|contribute|establish|evaluate|analyze|analyse)\b|\bour\s+(?:benchmark|dataset|method|framework|model|work distinguishes)\b|提出|构建|设计|建立|贡献/i.test(text);
  const methodCue = /\b(?:collect\w*|curat\w*|annotat\w*|construct\w*|compris\w*|consist\w*|contain\w*|train\w*|distill\w*|encod\w*|decod\w*|rasteriz\w*|render\w*|optimis\w*|optimiz\w*|clon\w*|densif\w*|split\w*|prun\w*|sample\w*|prompt\w*)\b|采集|收集|标注|构建|训练|蒸馏|编码|解码|渲染|优化|筛选|提示|密度控制|克隆/i.test(text);
  const resultCue = /\b(?:outperform\w*|improv\w*|achiev\w*|attain\w*|declin\w*|decreas\w*|increas\w*|compar\w*|performance|accuracy|fps|ablation)\b|提升|下降|优于|相比|准确率|性能|消融/i.test(text);
  if (experiment && resultCue) return 'result';
  if ((intro || /\b(?:we introduce|we propose|our work distinguishes)\b/i.test(text)) && contributionCue) return 'contribution';
  if (resultCue && /\d+(?:\.\d+)?\s*%/.test(text)
    && !/\b(?:we|our|the authors?)\b.{0,35}\b(?:collect\w*|annotat\w*|train\w*|construct\w*)\b/i.test(text)) return 'result';
  if (method && methodCue) return 'method';
  if (methodCue && !experiment) return 'method';
  if (contributionCue) return 'contribution';
  if (resultCue && /\d|\b(?:short|long|with|without)\b|短|长/i.test(text)) return 'result';
  return undefined;
}

function threeLinePassageQuality(passage: EvidencePassage): number {
  const title = passage.sectionTitle;
  const text = passage.text.trim();
  // PDF.js may stop a passage midway through its final clause even when
  // earlier sentences contain independently usable evidence. Keep those
  // sentences eligible; the model is explicitly told not to use the fragment.
  const completeSentences = (text.match(/[.!?。！？](?=\s|$)/g) ?? []).length;
  const hasCompleteCore = completeSentences >= 2 && text.length >= 170;
  if (/\b(?:acknowledg\w*|references|bibliography|appendix|supplementary)\b|致谢|参考文献|附录/i.test(title)) return 0;
  if (/\b(?:related work|discussions?|conclusions?|future work)\b|相关工作|讨论|结论|未来工作/i.test(title)) return 0;
  if (/^(?:fig\.?|figure|table|tab\.?|algorithm)\s*\d+\b|^(?:图|表)\s*\d+/i.test(text)) return 0;
  if (/^(?:ACM Reference Format|CCS Concepts|Authors?[’']? addresses|Publication rights|We first briefly overview)\b|^\d{4}\]|^\d+\s+in\s+all\s+our\s+tests\b/i.test(text)) return 0;
  if (/^\d+%\)/.test(text)) return 0;
  if (!hasCompleteCore && /\b(?:the|a|an|of|for|with|to|by|and|or|in)\s*$/i.test(text)
    && !/\b\d+\s*fps\b.{0,100}\b(?:1080p|resolution)\b[^.]*\./i.test(text)) return 0;
  if (/\b(?:our method is not without limitations|in conclusion|non-obvious differences in quality)\b/i.test(text)) return 0;
  if (/\b(?:acknowledg\w*|we thank|grateful to|funded by|supported by|efforts made by)\b|致谢|感谢|资助/i.test(text)) return 0;
  if (/^(?:performance of|comparison of|experimental results|evaluation of)\b[^.!?。！？]*[.:]?$/.test(text)) return 0;
  if (/\b(?:eval-|contri-|experi-)\s*$/i.test(text)) return 0;
  if (/^[,;:]/.test(text) || /[A-Za-z]-$/.test(text)) return 0;
  if (/^[a-z]/.test(text) && !/\b(?:we|our|this paper|the authors?)\b.{0,90}\b(?:introduc\w*|propos\w*|collect\w*|curat\w*|annotat\w*|construct\w*|design\w*|evaluat\w*|train\w*|render\w*)\b/i.test(text)) return 0;
  if (!hasCompleteCore && /\b(?:e\.g\.,|i\.e\.,)\s*$|[(:,]\s*$/.test(text)) return 0;
  if (/^\d+\.\d+\s+[A-Z]\w+\s+(?:achiev\w*|attain\w*|improv\w*)\b/.test(text)) return 0;
  if (/^[a-z]/.test(text) && !/[.!?。！？]$/.test(text)) return 0;
  const length = Array.from(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
  if (length < 42) return 0;
  // PDF.js sometimes begins in the middle of a line or omits terminal
  // punctuation. Such passages are a fallback only when their content still
  // identifies a concrete contribution, mechanism, or result.
  return /[.!?。！？]$/.test(text) && length >= 55 ? 2 : 1;
}

function selectThreeLinePassages(ledger: EvidenceLedger, limit: number, pages?: readonly PageExtraction[]): EvidencePassage[] {
  const passages = createEvidencePassages(ledger, { targetChars: 450, maxChars: 600, pages }).passages;
  const groups: Record<ThreeLineCategory, EvidencePassage[]> = { contribution: [], method: [], result: [] };
  for (const passage of passages) {
    if (threeLinePassageQuality(passage) === 0) continue;
    const category = threeLineCategory(passage);
    if (category) groups[category].push(passage);
  }
  const sectionPriority = (passage: EvidencePassage, category: ThreeLineCategory): number => {
    const title = passage.sectionTitle;
    if (category === 'contribution') return /\b(?:introduction|contributions?)\b|引言|贡献/i.test(title) ? 2 : /\babstract\b|摘要/i.test(title) ? 1 : 0;
    if (category === 'method') return /\b(?:method|approach|construction|collection|annotation|architecture|data engine)\b|方法|构建|采集|标注|架构/i.test(title) ? 2 : 0;
    return /\b(?:experiments?|evaluation|results?|analysis|analyses|ablation)\b|实验|评测|结果|分析|消融/i.test(title) ? 2 : 0;
  };
  for (const category of Object.keys(groups) as ThreeLineCategory[]) {
    const score = (passage: EvidencePassage) =>
      sectionPriority(passage, category) * 3 + threeLinePassageQuality(passage) * 4
      + Math.min(3, (passage.text.match(/\b\d+(?:[.,]\d+)?(?:%|\s+\w+)?/g) ?? []).length)
      + Number(/\b(?:introduce|propose|curate|construct|collect|annotate|design|train|render|achieve|attain|improve|decline)\b/i.test(passage.text)) * 2
      + Number(/\b(?:distinguishes|contributions?)\b/i.test(passage.text) && /(?:^|\s)\d+[.)]/.test(passage.text)) * 4
      + Number(/\b(?:first|then|using|by|through|whereas|compared|outperform\w*|improv\w*|declin\w*)\b|首先|然后|通过|相比|提升|下降/i.test(passage.text))
      - Number(/^in this section\b|^we begin by outlining\b/i.test(passage.text)) * 3;
    groups[category].sort((a, b) => score(b) - score(a));
  }
  const selected: EvidencePassage[] = [];
  const perPage = new Map<number, number>();
  const add = (passage: EvidencePassage, pageLimit: number): boolean => {
    if (selected.length >= limit || (perPage.get(passage.pageIndex) ?? 0) >= pageLimit || selected.some((item) => nearDuplicate(item.text, passage.text))) return false;
    selected.push(passage);
    perPage.set(passage.pageIndex, (perPage.get(passage.pageIndex) ?? 0) + 1);
    return true;
  };
  // Reserve distinct research roles before broad contribution/method/result
  // filling. The cues cover model, dataset, benchmark and rendering papers;
  // no single named technique is required for admission.
  const substantive = [...new Set([...groups.contribution, ...groups.method, ...groups.result])];
  const hasTaskDefinition = substantive.some((passage) => /\btask\b.{0,55}\b(?:is to|requires?|asks?|given|return\w*|predict\w*|produce\w*|segment\w*|answer\w*)\b/i.test(passage.text));
  const facets = [
    (text: string) => /\btask\b.{0,55}\b(?:is to|requires?|asks?|given|return\w*|predict\w*|produce\w*|segment\w*|answer\w*)\b|\b(?:prompt\w*|segment\w*)\b.{0,75}\btask\s+is\b/i.test(text),
    (text: string) => /\b(?:encoder|embedding|representation|covariance|gaussian\w*|feature\w*|backbone|architecture|attention)\b|编码|嵌入|表征|协方差|特征|骨干|架构|注意力/i.test(text)
      && /\b(?:input|prompt|point|image|model|scene|initializ\w*|sparse|mask|decoder|parameter)\b|输入|提示|点|图像|模型|场景|初始化|掩码|参数/i.test(text),
    (text: string) => {
      const operations = text.match(hasTaskDefinition
        ? /\b(?:collect\w*|annotat\w*|curat\w*|filter\w*|train\w*|distill\w*|optimi[sz]\w*|clon\w*|densif\w*|split\w*|prun\w*)\b|采集|标注|筛选|训练|蒸馏|优化|克隆|拆分|剪枝/gi
        : /\b(?:train\w*|distill\w*|optimi[sz]\w*|clon\w*|densif\w*|split\w*|prun\w*)\b|训练|蒸馏|优化|克隆|拆分|剪枝/gi) ?? [];
      return new Set(operations.map((value) => value.toLocaleLowerCase().replace(/(?:ing|ed|es|s)$/, ''))).size >= 2;
    },
    (text: string) => /\b(?:distill\w*|teacher.student|on.policy)\b|蒸馏|教师.*学生/i.test(text)
      && /\b(?:teacher|student|logits|reward|knowledge|train\w*)\b|教师|学生|奖励|训练/i.test(text),
    (text: string) => /\b(?:decoder|decoding|rasteriz\w*|render\w*|draft|splatt\w*|inference)\b|解码|光栅|渲染|推理/i.test(text)
      && /\b(?:sort\w*|project\w*|visibility|tile|mask|output|parallel|token|cache|pixel)\b|排序|投影|可见|分块|掩码|输出|并行|缓存|像素/i.test(text),
    (text: string) => /\b\d+(?:\.\d+)?\s*(?:fps|%|points?)\b/i.test(text)
      && /\b(?:resolution|1080p|accuracy|compared|outperform\w*|improv\w*|speedup|long|short)\b|分辨率|准确率|速度|提升|对比/i.test(text),
    (text: string) => /\bclon\w*\b/i.test(text) && /\bsplit\w*\b/i.test(text),
    (text: string) => /\b(?:scaling laws?|compute.optimal|extrapolat\w*|crossover)\b/i.test(text)
      && /\b(?:predict\w*|compar\w*|increas\w*|decreas\w*|faster|efficien\w*)\b/i.test(text)
      && /\d/.test(text),
  ];
  for (const [facetIndex, matches] of facets.entries()) {
    const candidates = substantive.filter((passage) => matches(passage.text)
      && !(facetIndex === 1 && /^[-(]/.test(passage.text))
      && !(facetIndex === 1 && /^(?:to validate|we (?:evaluate|compare|test|assess))\b/i.test(passage.text)))
      .sort((left, right) => {
        const score = (passage: EvidencePassage) => threeLinePassageQuality(passage) * 4
          + Number(/\b(?:introduction|method|model|approach)\b/i.test(passage.sectionTitle)) * 3
          - Number(facetIndex !== facets.length - 1 && /\b(?:results?|experiments?|evaluation|ablation)\b/i.test(passage.sectionTitle)) * 9
          - Number(/\b(?:for this ablation|we evaluate if|we also assess|in conclusion|exploratory and empirical studies)\b|^(?:to validate|we evaluate|we compare|we test)\b/i.test(passage.text)) * 10
          - Number(/^[a-z-]/.test(passage.text)) * 5
          - Number(facetIndex === 1 && /^[-(]/.test(passage.text)) * 12
          - Number(facetIndex === 1 && /^\d/.test(passage.text)) * 8
          - Number(facetIndex === 4 && /\b(?:however,? it can only|previous methods?|prior work)\b/i.test(passage.text)) * 6
          + Number(/\b(?:we|our|this paper|the model)\b.{0,110}\b(?:create|use|design|sort|render|rasteriz\w*|decode|train|optimi[sz]\w*)\b/i.test(passage.text)) * 3
          + Number(facetIndex === 1 && /\b(?:input to our method|from these|we (?:represent|create|initialize|present|propose)|our model)\b/i.test(passage.text)) * 6
          + Number(facetIndex === 4 && /\b(?:rasteriz\w*|decoder|draft|tile|pixel)\b/i.test(passage.text)) * 6
          + Number(/\bclon\w*\b/i.test(passage.text) && /\bsplit\w*\b/i.test(passage.text)) * 5
          + Number(/\b(?:tile.based|depth.sort\w*|pre.sort\w*)\b/i.test(passage.text)) * 4;
        return score(right) - score(left) || right.text.length - left.text.length;
      });
    for (const passage of candidates) if (add(passage, 2)) break;
  }
  // Each bucket gets a fair chance before later material can fill the packet.
  for (const category of ['contribution', 'method', 'result'] as const) {
    for (const passage of groups[category]) {
      if (selected.filter((item) => groups[category].includes(item)).length >= Math.max(1, Math.floor(limit / 3))) break;
      add(passage, 2);
    }
  }
  for (const category of ['contribution', 'method', 'result'] as const) {
    for (const passage of groups[category]) {
      if (selected.length >= limit) break;
      if (!selected.includes(passage)) add(passage, 2);
    }
  }
  if (selected.length < Math.min(3, limit)) {
    for (const category of ['contribution', 'method', 'result'] as const) {
      for (const passage of groups[category]) {
        if (selected.length >= Math.min(3, limit)) break;
        if (!selected.includes(passage)) add(passage, 3);
      }
    }
  }
  return selected;
}

function nearDuplicate(left: string, right: string): boolean {
  const words = (value: string) => new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const a = words(left); const b = words(right);
  if (a.size < 8 || b.size < 8) return false;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.min(a.size, b.size) > 0.78;
}

function quoteDedupeKey(candidate: EvidenceCandidate): string {
  return candidate.quote.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Register complete, already selected body paragraphs without truncating their source text. */
export function createParagraphEvidencePacket(ledger: EvidenceLedger, paragraphs: readonly EvidencePassage[]): EvidencePacket {
  const current = new Set(ledger.candidates);
  for (const paragraph of paragraphs) {
    if (!paragraph.text.trim() || !paragraph.members.length || paragraph.members.some(member => !current.has(member.candidate))) {
      throw new Error('A paragraph packet must contain anchored passages from this exact current PDF ledger.');
    }
  }
  const packet: EvidencePacket = {
    purpose: 'three_line', coverage: ledger.coverage, coverageHints: coverageHints(ledger),
    sources: paragraphs.map((paragraph, index) => ({
      alias: `S${String(index + 1).padStart(2, '0')}`,
      slot: paragraph.members[0].candidate.slot, section: paragraph.sectionTitle,
      excerpt: paragraph.text, precision: paragraph.members[0].candidate.precision, coverage: ledger.coverage,
    })),
  };
  mappings.set(packet, new Map(packet.sources.map((source, index) => [source.alias, paragraphs[index]])));
  return packet;
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
  if (options.purpose === 'three_line' && !options.preferredSlots) {
    const selected = selectThreeLinePassages(ledger, maxCandidates, options.pages);
    const packet: EvidencePacket = {
      purpose: 'three_line', coverage: ledger.coverage, coverageHints: coverageHints(ledger),
      sources: selected.map((passage, index) => ({
        alias: `S${String(index + 1).padStart(2, '0')}`,
        slot: passage.members[0].candidate.slot,
        section: passage.sectionTitle,
        excerpt: truncateExcerpt(passage.text, maxExcerptChars),
        precision: passage.members[0].candidate.precision,
        coverage: passage.members[0].candidate.coverage,
      })),
    };
    mappings.set(packet, new Map(packet.sources.map((source, index) => [source.alias, selected[index]])));
    return packet;
  }
  const preferredSlots = options.preferredSlots ?? PURPOSE_SLOTS[options.purpose];
  const seenQuotes = new Set<string>();
  const selected: EvidenceCandidate[] = [];

  const ranked = rankCandidates(ledger.candidates, preferredSlots);
  for (const candidate of ranked) {
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
  return aliases.flatMap((alias) => {
    const source = mapping.get(alias);
    if (!source) throw new Error(`The model response referenced an unknown packet source alias: ${alias}.`);
    const candidates = 'members' in source ? source.members.map((member) => member.candidate) : [source];
    for (const candidate of candidates) verifyOriginalCandidate(candidate, ledger, pages);
    return candidates;
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
