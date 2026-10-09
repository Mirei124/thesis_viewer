import { isModelEligibleCandidate } from './evidencePacket';
import type { EvidenceCandidate, EvidenceLedger, EvidenceSlot } from './evidenceLedger';
import type { EvidencePassage, EvidencePassageCollection } from './evidencePassages';

/** Bump when tokenization, queries, or scoring rules change. */
export const LOCAL_RETRIEVAL_VERSION = 'local-lexical-retrieval-v10';

export type DetailedRetrievalPurpose =
  | 'problem_motivation'
  | 'method'
  | 'contributions_novelty'
  | 'contributions'
  | 'relative_novelty'
  | 'experiments_ablations'
  | 'limitations';

export const DETAILED_RETRIEVAL_PURPOSES: readonly DetailedRetrievalPurpose[] = [
  'problem_motivation', 'method', 'contributions_novelty', 'contributions', 'relative_novelty', 'experiments_ablations', 'limitations',
];

export type RetrievalScoreBreakdown = {
  lexical: number;
  sectionBoost: number;
  slotBoost: number;
  /** Query terms that actually occurred in this local excerpt. */
  matchedTokens: string[];
};

export type RankedEvidenceCandidate = {
  candidate: EvidenceCandidate;
  score: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  /** A diagnosis only; never send this or scores to the model. */
  diagnostics: string[];
};

export type RetrievalSelectionOptions = {
  /** Must fit the eventual progressive-stage evidence budget. */
  maxCandidates: number;
  /** Prevent one dense page from crowding out the rest of the paper. */
  maxCandidatesPerPage?: number;
  /** Whether a short high-ranked paragraph may bring one local neighbour. */
  includeAdjacent?: boolean;
};

export type RetrievalIndex = {
  version: typeof LOCAL_RETRIEVAL_VERSION;
  documentVersion: string;
  candidateCount: number;
  /** These local records deliberately retain no altered evidence or anchors. */
  records: readonly RetrievalRecord[];
  diagnostics: string[];
};

/** A passage index keeps the readable joined text for ranking, while its
 * members remain the only evidence anchors that can later be validated. */
export type PassageRetrievalIndex = {
  documentVersion: string;
  passages: readonly EvidencePassage[];
  diagnostics: string[];
};

export type RankedEvidencePassage = {
  passage: EvidencePassage;
  score: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  diagnostics: string[];
};

type RetrievalRecord = {
  candidate: EvidenceCandidate;
  tokens: readonly string[];
  termFrequency: ReadonlyMap<string, number>;
  length: number;
  sectionTokens: readonly string[];
};

type QueryDefinition = {
  terms: readonly string[];
  /** Broader, paper-type-specific cues. They expand recall without letting a
   * lone generic word such as "benchmark" displace direct method prose. */
  supplementaryTerms?: readonly string[];
  sectionTerms: readonly string[];
  slots: readonly EvidenceSlot[];
};

const QUERY_DEFINITIONS: Record<DetailedRetrievalPurpose, QueryDefinition> = {
  problem_motivation: {
    terms: ['problem', 'challenge', 'limitation', 'motivate', 'motivation', 'however', 'aim', 'address', '问题', '挑战', '动机', '限制', '局限', '目标', '解决'],
    sectionTerms: ['abstract', 'introduction', 'background', '摘要', '引言', '背景'], slots: ['problem', 'motivation', 'relative_novelty'],
  },
  method: {
    // "Method" is broader than a model architecture. Dataset, benchmark, and
    // evaluation papers legitimately describe their construction, annotation,
    // task, and protocol as the method. Keep the model-work vocabulary here
    // too: these are retrieval cues, not a paper-type classifier.
    terms: [
      'propose', 'framework', 'method', 'architecture', 'approach', 'model', 'consists', 'training', 'inference', 'algorithm',
      'encoder', 'decoder', 'attention', 'distillation', 'teacher', 'student', 'representation', 'optimization', 'density', 'rendering', 'rasterization', 'embedding',
      '方法', '框架', '模型', '架构', '训练', '推理', '算法', '提出',
    ],
    supplementaryTerms: [
      'dataset', 'benchmark', 'collection', 'collect', 'annotation', 'annotate', 'label', 'question', 'answer', 'qa', 'evaluation', 'evaluate', 'protocol', 'video', 'subtitle', 'audio',
      '数据集', '基准', '收集', '采集', '构建', '标注', '标签', '问题', '答案', '问答', '评测', '评估', '协议', '视频', '字幕', '音频',
    ],
    sectionTerms: [
      'method', 'methods', 'approach', 'model', 'framework', 'dataset', 'benchmark', 'data collection', 'annotation', 'evaluation',
      '方法', '模型', '框架', '数据集', '基准', '收集', '构建', '标注', '评测', '评估',
    ], slots: ['method_overview', 'method_step', 'experimental_setup', 'evaluation_scope'],
  },
  contributions_novelty: {
    terms: ['contribution', 'propose', 'introduce', 'novel', 'compared', 'prior', 'existing', 'different', '贡献', '提出', '相比', '创新', '已有'],
    sectionTerms: ['abstract', 'introduction', 'related', 'method', 'contribution', '摘要', '引言', '相关', '方法', '贡献'], slots: ['contribution', 'relative_novelty', 'method_overview', 'main_result'],
  },
  contributions: {
    terms: ['contribution', 'contributions', 'propose', 'introduce', 'novel', 'demonstrate', 'contribute', '贡献', '提出', '引入', '创新', '证明'],
    sectionTerms: ['abstract', 'introduction', 'conclusion', 'contribution', '摘要', '引言', '结论', '贡献'], slots: ['contribution', 'method_overview', 'main_result'],
  },
  relative_novelty: {
    terms: ['unlike', 'compared', 'prior', 'previous', 'existing', 'different', 'related', 'baseline', '相比', '不同', '已有', '现有', '先前', '相关工作'],
    sectionTerms: ['introduction', 'related', 'prior', 'method', '引言', '相关', '方法'], slots: ['relative_novelty', 'contribution', 'method_overview'],
  },
  experiments_ablations: {
    terms: ['experiment', 'evaluate', 'evaluation', 'dataset', 'baseline', 'result', 'results', 'table', 'ablation', 'performance', 'benchmark', '实验', '评估', '数据集', '结果', '消融', '性能', '基准'],
    sectionTerms: ['experiment', 'experiments', 'result', 'results', 'evaluation', 'ablation', '实验', '结果', '评估', '消融'], slots: ['main_result', 'ablation', 'experimental_setup', 'evaluation_scope'],
  },
  limitations: {
    terms: ['limitation', 'limitations', 'future', 'failure', 'fail', 'cannot', 'only', 'restricted', 'constraint', '局限', '限制', '未来', '失败', '无法', '仅', '约束'],
    sectionTerms: ['limitation', 'discussion', 'conclusion', 'future', '局限', '讨论', '结论', '未来'], slots: ['author_limitation', 'evaluation_scope', 'ablation'],
  },
};

const WORD = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}]/u;

/**
 * Small deterministic tokenizer: word tokens for alphabetic/numeric text and
 * CJK uni/bi-grams for Chinese/Japanese/Korean text. It is deliberately local
 * and dependency-free so a PDF's text never leaves the browser during search.
 */
export function tokenizeForRetrieval(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(WORD)) {
    const term = match[0];
    if (!term) continue;
    if ([...term].some((character) => CJK.test(character))) {
      const characters = [...term].filter((character) => CJK.test(character));
      for (let index = 0; index < characters.length; index += 1) tokens.push(characters[index]);
      for (let index = 0; index + 1 < characters.length; index += 1) tokens.push(`${characters[index]}${characters[index + 1]}`);
    } else {
      tokens.push(term);
    }
  }
  return tokens;
}

function termFrequency(tokens: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function includesAny(tokens: readonly string[], terms: readonly string[]): boolean {
  const available = new Set(tokens);
  return terms.some((term) => tokenizeForRetrieval(term).some((token) => available.has(token)));
}

/** Builds a re-generable, memory-only lexical index over already-local evidence. */
export function createRetrievalIndex(ledger: EvidenceLedger): RetrievalIndex {
  const records: RetrievalRecord[] = [];
  let excluded = 0;
  for (const candidate of ledger.candidates) {
    if (candidate.coverage === 'unreadable' || !isModelEligibleCandidate(candidate, ledger.candidates)) {
      excluded += 1;
      continue;
    }
    const tokens = tokenizeForRetrieval(candidate.quote);
    if (tokens.length === 0) {
      excluded += 1;
      continue;
    }
    records.push({ candidate, tokens, termFrequency: termFrequency(tokens), length: tokens.length, sectionTokens: tokenizeForRetrieval(candidate.section.title) });
  }
  return {
    version: LOCAL_RETRIEVAL_VERSION,
    documentVersion: ledger.documentVersion,
    candidateCount: records.length,
    records,
    diagnostics: records.length === 0
      ? ['No eligible readable body excerpts are available for local retrieval.']
      : [`${records.length} eligible readable body excerpt${records.length === 1 ? '' : 's'} indexed locally; ${excluded} candidate${excluded === 1 ? '' : 's'} excluded by the shared evidence quality rule.`],
  };
}

/** Builds a local lexical index over conservative, readable passages rather
 * than individual PDF.js text items. */
export function createPassageRetrievalIndex(collection: EvidencePassageCollection): PassageRetrievalIndex {
  return {
    documentVersion: collection.documentVersion,
    passages: collection.passages.map(trimStrandedPassageEdges).filter(isPassageModelEligible),
    diagnostics: collection.passages.length
      ? [`${collection.passages.length} locally joined passages are available for retrieval.`]
      : ['No locally joined readable passages are available for retrieval.'],
  };
}

function trimStrandedPassageEdges(passage: EvidencePassage): EvidencePassage {
  let text = passage.text;
  // PDF text order may start with a detached continuation before a complete
  // sentence. Keep the original members intact and expose only the readable
  // suffix when the boundary is explicit in the extracted text.
  if (/^[,.;:]/.test(text)) {
    const boundary = /[.!?。！？]\s+(?=(?:After|Before|During|First|Next|Then|Finally|We|Our|The|For|In)\b)/i.exec(text);
    if (boundary && boundary.index < 300) text = text.slice(boundary.index + boundary[0].length);
  }
  // A detached explanatory clause has no usable value without its PDF math
  // continuation. The preceding main clause remains exact source wording.
  text = text.replace(/,\s*i\.e\.,?\s+with\s*$/i, '');
  return text === passage.text ? passage : { ...passage, text,
    diagnostics: [...passage.diagnostics, 'Trimmed stranded PDF text at a sentence boundary; original member quotes and anchors remain unchanged.'] };
}

function isPassageModelEligible(passage: EvidencePassage): boolean {
  const text = passage.text.trim();
  const completeQuantifiedContrast = /^(?:however|therefore|thus|in contrast)\b/i.test(text)
    && /\b(?:increas\w*|decreas\w*|improv\w*|declin\w*|chang\w*)\b/i.test(text)
    && (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length >= 2
    && /[.!?。！？]$/.test(text);
  if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 38) return false;
  if (/\b(?:acknowledg\w*|references|bibliography)\b|致谢|参考文献/i.test(passage.sectionTitle)) return false;
  if (/^(?:fig\.?|figure|table|tab\.?|algorithm)\s*\d+\b|^(?:图|表)\s*\d+/i.test(text)) return false;
  if (/^\(?(?:tab\.?|table|fig\.?|figure)\s*\d+\b/i.test(text)) return false;
  if (/^(?:how|what|why|when|where|which)\b[^.!。！？]*\?$/.test(text)) return false;
  if (/\b(?:we thank|grateful to|funded by|supported by|efforts made by)\b|致谢|感谢|资助/i.test(text)) return false;
  if (/^(?:performance of|comparison of|experimental results|evaluation of)\b[^.!?。！？]*[.:]?$/.test(text)) return false;
  if (/^in this section,?\s+we\s+(?:evaluate|present|discuss|outline|describe|investigate)\b/i.test(text) && !/\d/.test(text)) return false;
  if (/^we conduct (?:further )?analysis to explore\b/i.test(text) && !/\d/.test(text)) return false;
  if (/\b(?:eval-|contri-|experi-)\s*$/i.test(text)) return false;
  if (/^[.,;:]/.test(text)) return false;
  if (/^[-–]/.test(text) && !/^.{100,}[.!?。！？].+[.!?。！？]/s.test(text)) return false;
  // Permit a trailing PDF.js syllable when the preceding prose contains two complete sentences.
  if (/[A-Za-z]-$/.test(text) && !/^.{150,}[.!?。！？].+[.!?。！？]/s.test(text)) return false;
  if (/^[a-z]/.test(text) && !/\b(?:we|our|this paper|the authors?)\b.{0,90}\b(?:introduc\w*|propos\w*|collect\w*|curat\w*|annotat\w*|construct\w*|design\w*|evaluat\w*|train\w*|render\w*)\b/i.test(text)
    && !/^[^.?!。！？]{1,45}[.?!。！？]\s*.{100,}[.?!。！？]/s.test(text)
    && !completeQuantifiedContrast) return false;
  return true;
}

function passageCompleteness(passage: EvidencePassage): number {
  const text = passage.text.trim();
  return Number(!/^[a-z]/.test(text)) + Number(/[.!?。！？]/.test(text)) - Number(/[:;：；]$/.test(text));
}

export function rankPassagesForPurpose(
  index: PassageRetrievalIndex,
  purpose: DetailedRetrievalPurpose,
  maxPassages = 12,
): RankedEvidencePassage[] {
  if (!Number.isInteger(maxPassages) || maxPassages < 1) throw new Error('maxPassages must be a positive integer.');
  if (!index.passages.length) return [];
  const definition = QUERY_DEFINITIONS[purpose];
  const terms = queryTokens(definition);
  const records = index.passages.map((passage) => ({
    passage,
    tokens: tokenizeForRetrieval(passage.text),
    frequencies: termFrequency(tokenizeForRetrieval(passage.text)),
    sectionTokens: tokenizeForRetrieval(passage.sectionTitle),
  }));
  const averageLength = records.reduce((sum, record) => sum + record.tokens.length, 0) / records.length;
  const documentFrequency = new Map(terms.map((term) => [term, records.filter((record) => record.frequencies.has(term)).length]));
  return records.map((record, sourceIndex) => {
    let lexical = 0;
    const matchedTokens: string[] = [];
    for (const term of terms) {
      const frequency = record.frequencies.get(term) ?? 0;
      if (!frequency) continue;
      matchedTokens.push(term);
      const denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * (record.tokens.length / averageLength));
      lexical += inverseDocumentFrequency(records.length, documentFrequency.get(term) ?? 0) * ((frequency * 2.2) / denominator);
    }
    const sectionBoost = includesAny(record.sectionTokens, definition.sectionTerms) ? 0.35 : 0;
    const slotBoost = record.passage.members.some((member) => definition.slots.includes(member.candidate.slot)) ? 0.15 : 0;
    // A concrete process or measured comparison is more useful than a list of
    // generic query words repeated in an abstract or section heading.
    const direct = passageCategory(record.passage, purpose) !== 'general' ? 2 : 0;
    const offPurposePenalty = purpose === 'method' && ['result', 'ablation'].includes(passageCategory(record.passage, 'experiments_ablations')) ? 4 : 0;
    const offSectionPenalty = purpose === 'method' && /\b(?:discussion|conclusion|related work)\b|讨论|结论|相关工作/i.test(record.passage.sectionTitle) ? 4 : 0;
    const methodSectionBoost = purpose === 'method' && /\b(?:method|approach|construction|collection|annotation|architecture|data engine|video-mme)\b|方法|构建|采集|标注|架构/i.test(record.passage.sectionTitle) ? 2 : 0;
    const noveltyDetail = purpose === 'relative_novelty'
      ? (/\b(?:unlike|compared with|in contrast|different from|whereas|distinguishes from|existing benchmarks)\b|相对|相比|不同于/i.test(record.passage.text) ? 5 : 0)
        + (/(?:^|\s)\(?\d+[.)]|\b(?:first|second|third|fourth)\b|首先|其次/i.test(record.passage.text) ? 3 : 0)
      : 0;
    const specificity = purpose === 'experiments_ablations' && ['result', 'analysis', 'ablation'].includes(passageCategory(record.passage, purpose)) ? 2 : 0;
    const measuredComparison = purpose === 'experiments_ablations'
      && /\d+(?:\.\d+)?\s*(?:%|(?:fps|points?|ms|seconds?|minutes?)\b)/i.test(record.passage.text)
      && /\b(?:compar\w*|outperform\w*|surpass\w*|improv\w*|attain\w*|achiev\w*|declin\w*|decreas\w*|increas\w*)\b|相比|优于|提升|下降/i.test(record.passage.text) ? 5 : 0;
    const pairedNumericChange = purpose === 'experiments_ablations'
      && /\b(?:from|between)\s+(?:[a-z]\s*=?\s*)?\d+(?:\.\d+)?\s+(?:to|and)\s+(?:[a-z]\s*=?\s*)?\d+(?:\.\d+)?\b/i.test(record.passage.text)
      && /\b(?:increas\w*|decreas\w*|improv\w*|declin\w*|chang\w*|shift\w*)\b/i.test(record.passage.text) ? 6 : 0;
    const completeness = passageCompleteness(record.passage);
    const genericIntroPenalty = /^in this section\b|^we begin by outlining\b/i.test(record.passage.text) && !/\d/.test(record.passage.text) ? 6 : 0;
    const conclusionPenalty = purpose === 'experiments_ablations' && /\b(?:conclusion|discussion)\b|结论|讨论/i.test(record.passage.sectionTitle) ? 4 : 0;
    return { passage: record.passage, score: lexical + sectionBoost + slotBoost + direct + methodSectionBoost + noveltyDetail + specificity + measuredComparison + pairedNumericChange + completeness - offPurposePenalty - offSectionPenalty - genericIntroPenalty - conclusionPenalty,
      scoreBreakdown: { lexical, sectionBoost, slotBoost, matchedTokens },
      diagnostics: [lexical ? `Matched ${matchedTokens.length} local purpose token${matchedTokens.length === 1 ? '' : 's'}.` : 'No purpose query token matched; retained as readable global-body fallback.'], sourceIndex };
  }).sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .slice(0, maxPassages).map(({ sourceIndex: _sourceIndex, ...item }) => item);
}

type MethodAspect = 'input' | 'representation' | 'training' | 'supervision' | 'distillation' | 'adaptation' | 'rasterization' | 'pipeline' | 'inference' | 'collection' | 'annotation' | 'quality' | 'protocol';

/** These are broad process roles, not a vocabulary for any one paper. A
 * passage may cover several roles; only roles supported by readable passages
 * can earn a coverage bonus. */
function methodAspects(text: string): Set<MethodAspect> {
  const rules: [MethodAspect, RegExp][] = [
    ['input', /\b(?:input|initializ\w*|calibrat\w*|source images?|sparse points?|point cloud|prompts?)\b|输入|初始化|稀疏点|提示/i],
    ['representation', /\b(?:represent\w*|features?|encod\w*|embedd\w*|architecture|covariance|attention|parameters?)\b|表征|特征|编码|架构|协方差|注意力|参数/i],
    ['training', /\b(?:train\w*|fine.tun\w*|supervised|reinforcement|distill\w*|optimis\w*|optimiz\w*|densif\w*|clon\w*|prun\w*)\b|训练|微调|蒸馏|优化|密度控制|克隆|剪枝/i],
    ['supervision', /\b(?:supervised fine.tuning|sft stage|instruction tuning|pre.training|fine.tuning)\b|监督微调|预训练/i],
    ['distillation', /\b(?:distill\w*|teacher.student|teacher logits|on.policy)\b|蒸馏|教师模型/i],
    ['adaptation', /\b(?:densif\w*|density control|clon\w*|prun\w*|splitt?ing|split strategy)\b|密度控制|克隆|拆分|剪枝/i],
    ['rasterization', /\b(?:rasteriz\w*|tile.based|depth.sort\w*|sort\w* splats?|splat\w* to)\b|光栅|分块渲染/i],
    ['pipeline', /\b(?:three.stage|multi.stage|\d+ stages|first stage|second stage|three steps|\d+ steps)\b|三阶段|多阶段|步骤/i],
    ['inference', /\b(?:infer\w*|decod\w*|predict\w*|render\w*|rasteriz\w*|splat\w*|composit\w*)\b|推理|解码|预测|渲染|光栅/i],
    ['collection', /\b(?:collect\w*|curat\w*|gather\w*|source\w*|sample\w*|construct\w*|data engine)\b|采集|收集|构建|筛选/i],
    ['annotation', /\b(?:annotat\w*|label\w*|question.answer|qa pairs?|human raters?)\b|标注|标签|问答/i],
    ['quality', /\b(?:quality (?:control|review|check)|review\w*|verif\w*|validat\w*|double.check\w*|exam\w*)\b|质检|复核|验证|审核/i],
    ['protocol', /\b(?:evaluation protocol|evaluation setting|test protocol|metric|evaluat\w*|assessment|benchmark task)\b|评测协议|评测设置|指标|评估/i],
  ];
  return new Set(rules.filter(([, rule]) => rule.test(text)).map(([aspect]) => aspect));
}

function hasSourceCollectionAction(text: string): boolean {
  return /\b(?:we|our team|the authors?)\b.{0,150}\b(?:collect\w*|curat\w*|sourc\w*|gather\w*)\b.{0,70}\b(?:videos?|images?|samples?|datasets?|documents?|scenes?)\b/i.test(text);
}

function methodPassageQuality(passage: EvidencePassage): number | undefined {
  const { text, sectionTitle } = passage;
  if (passage.passageId.includes(':equation:') && /\b(?:compute.optimal allocation|compute.optimal frontiers?)\b/i.test(text)
    && /\$[^$]{8,160}\$/.test(text)) return 12;
  // These sections describe prior work, outcomes, or speculation. In
  // particular, plural "Discussions" must not bypass admission through a
  // separate facet reservation path.
  if (/\b(?:related work|prior work|discussions?|conclusions?|future work|acknowledg\w*|references)\b|相关工作|讨论|结论|未来工作|致谢|参考文献/i.test(sectionTitle)) return undefined;
  if (/^(?:fig\.?|figure|table|tab\.?|algorithm)\s*\d+\b|^(?:图|表)\s*\d+/i.test(text)) return undefined;
  if (/^\d+\s+[^.]{2,35}[.!?]\s+[A-Z]/.test(sectionTitle)) return undefined;
  const action = /\b(?:we|our|this paper|this model|the model|the dataset|the system|annotators?)\b.{0,180}\b(?:use\w*|represent\w*|conduct\w*|check\w*|examin\w*|provid\w*|filter\w*|configur\w*|clon\w*|split\w*|densif\w*|build\w*|creat\w*|design\w*|construct\w*|collect\w*|curat\w*|annotat\w*|review\w*|verif\w*|train\w*|encode\w*|decode\w*|initializ\w*|optimi[sz]\w*|render\w*|predict\w*|estimat\w*|fit\w*|adopt\w*|employ\w*|compris\w*|consist\w*)\b|(?:我们|本文|模型|数据集).{0,80}(?:采用|构建|收集|标注|训练|编码|解码|优化|渲染)/i.test(text);
  const procedural = /\b(?:is|are|was|were|using|through|via|with|from|into|then|first|each)\b.{0,110}\b(?:encod\w*|decod\w*|train\w*|annotat\w*|review\w*|verif\w*|initializ\w*|optimi[sz]\w*|render\w*|rasteriz\w*|collect\w*|construct\w*|sample\w*)\b/i.test(text);
  const mechanism = /\b(?:stage|step|module|encoder|decoder|renderer|rasterizer|pipeline|engine|distillation|optimization|representation|density control|gaussians?|features?|points?)\b.{0,110}\b(?:uses|serves|transforms|computes|embeds|combines|predicts|produces|generates|sorts|projects|maps|splits|clones|processes|initializes|represents)\b/i.test(text);
  const controlledSetup = /\b(?:matched|controlled)\b.{0,120}\b(?:models?|decoders?|architectures?|comparison|study|ladder)\b.{0,300}\b(?:same|shared|sharing|identical)\b/i.test(text);
  const aspects = methodAspects(text);
  if (!aspects.size || (!action && !procedural && !mechanism && !controlledSetup)) return undefined;
  const resultsSection = /\b(?:results?|experiments?|analysis|statistics|ablations?|zero.shot|transfer)\b|结果|实验|分析|统计|消融/i.test(sectionTitle);
  if (/^\s*(?:we extensively evaluate|in this section,? we evaluate|ideally,? for|we visualize representative|we take inspiration from|these highlighted cases underscore)\b/i.test(text)) return undefined;
  if (/^\s*in this section\b/i.test(text) && /(?:§\s*\d|first examines|then uses|finally examines)/i.test(text)) return undefined;
  if (/^[a-z]/.test(text) && text.length < 200 && !controlledSetup && !/\b(?:we|our|the (?:model|system|dataset))\b.{0,120}\b(?:collect\w*|curat\w*|annotat\w*|train\w*|encod\w*|decod\w*|render\w*|optimi[sz]\w*)\b/i.test(text)) return undefined;
  if (/^\s*in the following,? we (?:elaborate|describe|discuss)\b/i.test(text)) return undefined;
  if (/^\s*to this end,? we conduct a controlled scaling study\b/i.test(text)) return undefined;
  const leadingFragment = /^\s*[a-z]{2,20}\.\s+(?=[A-Z])/.test(text);
  if (leadingFragment && !/\b(?:we|our|the (?:model|system|dataset))\b.{0,100}\b(?:collect\w*|curat\w*|annotat\w*|construct\w*|train\w*|encod\w*|render\w*)\b/i.test(text)) return undefined;
  if (/\b(?:we anticipate|it(?:’|')s also interesting to compare|future work)\b/i.test(text)) return undefined;
  if (/\bwe find\b.{0,100}\b(?:performance|improvement|generaliz\w*|boost\w*)\b/i.test(text)
    && /\b(?:results?|figure \d+|training curve)\b/i.test(text)) return undefined;
  if (resultsSection && /\b(?:results? show|we (?:evaluate|compare|report|assess)|ablation|we use the same hyperparameter|statistical analysis)\b|结果表明|消融实验/i.test(text)) return undefined;
  const generic = /^\s*(?:in this section|we begin by|the details are as follows|our experiments show)\b/i.test(text);
  const namedComponentsOnly = /^\s*(?:we next describe|this section describes)\b/i.test(text)
    && /\b(?:has \w+ components?|details? in|high.level)\b/i.test(text);
  const sourceCollection = hasSourceCollectionAction(text);
  const internalTransform = /\b(?:we (?:represent|encode|embed|combine|map|initialize)|(?:encoder|decoder|rasterizer|renderer)\b.{0,100}\b(?:maps|embeds|encodes|computes|produces|sorts|processes)|(?:points?|boxes?|masks?|prompts?)\b.{0,120}\b(?:positional encod\w*|convolutions?|embeddings?))\b/i.test(text);
  const inputEncodingStep = /\b(?:points?|boxes?|masks?|prompts?|text)\b.{0,140}\b(?:positional encod\w*|convolutions?|learned embeddings?|text encoder)\b.{0,160}\b(?:sum\w*|embedd\w*|combin\w*)\b/i.test(text);
  const endToEndFlow = /\bencod\w*\b.{0,220}\b(?:embedd\w*|features?)\b.{0,220}\bdecod\w*\b.{0,120}\b(?:predict\w*|produc\w*|map\w*)\b/i.test(text);
  const independentReview = /\b(?:review|verif\w*|quality check)\b.{0,160}\b(?:different|independent|second|criteria|clear|consistent|filter)\b|\b(?:different|independent|second)\b.{0,100}\b(?:review|verif\w*)\b/i.test(text);
  const processActions = new Set((text.match(/\b(?:collect\w*|annotat\w*|review\w*|verif\w*|train\w*|encod\w*|decod\w*|initializ\w*|optimi[sz]\w*|render\w*|rasteriz\w*|clon\w*|split\w*|prun\w*|sort\w*|project\w*|filter\w*|sample\w*)\b/gi) ?? []).map((word) => word.toLowerCase()));
  if (text.length < 120 && processActions.size === 0 && !mechanism) return undefined;
  const prior = /^\s*(?:prior|previous|existing|other|traditional)\s+(?:work|models?|methods?|approaches?)\b|^\s*et al\.|\b(?:we first briefly overview|for complete coverage of the field)\b/i.test(text);
  if (prior && !/\b(?:we (?:introduce|propose|design|create)|our (?:method|approach))\b/i.test(text)) return undefined;
  return (action ? 4 : 0) + (procedural ? 2 : 0) + (mechanism ? 3 : 0) + (/[.!?。！？]/.test(text) ? 1 : 0)
    + (/\b(?:\d+(?:\.\d+)?(?:%|\s*(?:stages?|layers?|images?|masks?|videos?|tokens?))|first|second|third|finally|then|each)\b|首先|随后|最后/i.test(text) ? 2 : 0)
    - (resultsSection ? 14 : 0) - (generic ? 7 : 0) - (prior ? 7 : 0) - (namedComponentsOnly ? 7 : 0)
    - (passageCompleteness(passage) < 1 ? 3 : 0)
    - (/^[a-z\d–-]/.test(text) && !leadingFragment ? 8 : 0)
    - (/[A-Za-z]-$/.test(text) ? 5 : 0)
    - (/\b(?:implemented our method in Python|interactive viewer|source code and all our data)\b/i.test(text) ? 8 : 0)
    - (/\b(?:et al\.|supplemental|for complete coverage)\b/i.test(text) ? 7 : 0)
    - ((text.match(/\[[^\]]+\]/g) ?? []).length >= 3 ? 4 : 0)
    + Math.min(processActions.size, 3) * 1.4
    + (sourceCollection && /\b(?:data engine|dataset construction|benchmark construction|collection)\b/i.test(sectionTitle) ? 4 : 0)
    + (controlledSetup ? 8 : 0)
    + (/\bmatched\b.{0,70}\b\d+\b.{0,80}\b(?:models?|decoders?|architectures?)\b/i.test(text) ? 8 : 0)
    + (internalTransform ? 7 : 0) + (inputEncodingStep ? 8 : 0) + (endToEndFlow ? 9 : 0) + (independentReview ? 6 : 0)
    + (/\b(?:three|\d+) stages?\b.{0,200}\(1\).{0,200}\(2\).{0,200}\(3\)/i.test(text) ? 5 : 0)
    + (/\b(?:from (?:these|the|this|input).{0,100}\b(?:create|initialize|produce)|input to our method|(?:three|\d+) components?.{0,140}encod|encod\w*.{0,120}decod\w*|small.{0,140}(?:clon|split).{0,140}large|large.{0,140}(?:clon|split).{0,140}small|multi.teacher on.policy distillation|on.policy distillation)\b/i.test(text) ? 7 : 0)
    + (/\b(?:the input to our method|from these|during optimization|our model consists|the .* encoder|we configure|we train|we construct|we annotate|we conduct a .* review)\b/i.test(text) ? 4 : 0);
}

function passagePosition(passage: EvidencePassage): { first: number; last: number } | undefined {
  const orders = passage.members.map(({ candidate }) => {
    const match = /:p(\d+):i(\d+)$/.exec(candidate.evidenceId);
    return match && Number(match[1]) === passage.pageIndex ? Number(match[2]) : undefined;
  });
  return orders.length && orders.every((order, index) => order !== undefined && (index === 0 || order > orders[index - 1]!))
    ? { first: orders[0]!, last: orders[orders.length - 1]! } : undefined;
}

function sameLocalNeighbour(left: EvidencePassage, right: EvidencePassage): boolean {
  if (left.pageIndex < 0 || left.pageIndex !== right.pageIndex || left.sectionTitle.trim() !== right.sectionTitle.trim()) return false;
  const a = passagePosition(left);
  const b = passagePosition(right);
  return Boolean(a && b && (Math.abs(a.last - b!.first) <= 2 || Math.abs(b!.last - a.first) <= 2));
}

type MethodStep = 'collection' | 'collection_detail' | 'annotation' | 'annotation_detail' | 'review' | 'sample_scale' | 'annotation_scale' | 'image_encoding' | 'prompt_encoding' | 'decoding' | 'data_engine' | 'matched_setup' | 'allocation_fit' | 'allocation_equation' | 'representation' | 'optimization' | 'density_growth' | 'density_cleanup' | 'training' | 'inference';

function methodSteps(passage: EvidencePassage): Set<MethodStep> {
  const text = passage.text;
  const rules: [MethodStep, RegExp][] = [
    ['collection', /\b(?:collect\w*|curat\w*|sourc\w*|gather\w*)\b.{0,100}\b(?:videos?|images?|samples?|datasets?|scenes?|data)\b/i],
    ['collection_detail', /\b(?:sourc\w*|collect\w*|sample\w*|gather\w*)\b.{0,200}\b(?:domains?|categor\w*|criteria|duration|platform|videos?|images?|samples?)\b/i],
    ['annotation', /\b(?:annotat\w*|label\w*|create\w*)\b.{0,140}\b(?:questions?|answers?|qa pairs?|masks?|labels?)\b/i],
    ['annotation_detail', /\bannotators?\b.{0,220}\b(?:creat\w*|writ\w*|annotat\w*|label\w*)\b.{0,100}\b(?:questions?|answers?|qa pairs?|masks?|labels?)\b/i],
    ['review', /\b(?:review\w*|verif\w*|quality check|filter\w*)\b.{0,140}\b(?:qa pairs?|questions?|answers?|labels?|masks?|samples?|different annotator|text.only)\b/i],
    ['sample_scale', /\b\d[\d,.]*\s*(?:videos?|images?|samples?|scenes?)\b/i],
    ['annotation_scale', /\b\d[\d,.]*\s*(?:qa pairs?|questions?|answers?|masks?|labels?)\b/i],
    ['image_encoding', /\b(?:image|visual) encoder\b.{0,150}\b(?:pre.train\w*|transformer|compute\w*|once|embedd\w*)\b|\b(?:pre.train\w*|transformer)\b.{0,260}\b(?:image|visual) encoder\b/i],
    ['prompt_encoding', /\b(?:prompt|point|box|mask|text)\b.{0,150}\b(?:positional encod\w*|convolution\w*|text encoder|prompt embedd\w*)\b/i],
    ['decoding', /\b(?:decoder|decoding)\b.{0,130}\b(?:maps?|combin\w*|predict\w*|produc\w*|mask|output)\b/i],
    ['data_engine', /\bdata engine\b.{0,180}\b(?:stages?|annotat\w*|generat\w*|collect\w*)\b/i],
    ['matched_setup', /\b(?:matched|controlled)\b.{0,120}\b(?:models?|decoders?|architectures?|comparison|study|ladder)\b.{0,300}\b(?:same|shared|sharing|identical)\b/i],
    ['allocation_fit', /\b(?:IsoFLOP|compute.optimal allocation|fit(?:ted)? scaling laws?)\b/i],
    ['allocation_equation', /\bcompute.optimal allocation law\b.{0,60}\$[^$]+\$/i],
    ['representation', /\b(?:represent\w*|covariance|architecture|attention|transformer)\b.{0,140}\b(?:features?|gaussians?|layers?|embedd\w*|tokens?|input|images?)\b/i],
    ['optimization', /\b(?:optimis\w*|optimiz\w*|densif\w*|density control|clon\w*|prun\w*|split\w*)\b/i],
    ['density_growth', /\b(?:densif\w*|clon\w*|split\w*)\b/i],
    ['density_cleanup', /\b(?:we\s+(?:also\s+)?(?:prune|remove)|remov\w*.{0,90}(?:transparent|opacity))\b/i],
    ['training', /\b(?:train\w*|fine.tun\w*|distill\w*|reinforcement learning)\b/i],
    ['inference', /\b(?:infer\w*|decod\w*|rasteriz\w*|render\w*)\b/i],
  ];
  return new Set(rules.filter(([, rule]) => rule.test(text)).map(([step]) => step));
}

function joinedMethodNeighbour(left: EvidencePassage, right: EvidencePassage): EvidencePassage | undefined {
  const a = passagePosition(left);
  const b = passagePosition(right);
  if (!a || !b || left.pageIndex !== right.pageIndex || left.sectionTitle !== right.sectionTitle
    || !/[.!?。！？]$/.test(left.text.trim()) || !/[.!?。！？]$/.test(right.text.trim())) return undefined;
  const shortArchitecturePair = b.first - a.last === 2 && left.text.length <= 240 && right.text.length <= 150
    && /\b(?:encoder|decoder|transformer|network|module|representation)\b/i.test(left.text)
    && /\b(?:encoder|decoder|transformer|network|module|representation)\b/i.test(right.text);
  // A short prompt-encoding paragraph and its mask-decoding paragraph may be
  // separated by a subsection label that the passage builder correctly omits.
  // Keep them as two paragraphs so the input does not imply one sentence.
  const complementaryFlow = b.first - a.last <= 4 && b.first - a.last >= 2
    && left.text.length <= 500 && right.text.length <= 180
    && methodSteps(left).has('prompt_encoding') && methodSteps(right).has('decoding');
  if (!shortArchitecturePair && !complementaryFlow) return undefined;
  const separator = complementaryFlow ? '\n' : ' ';
  const text = `${left.text}${separator}${right.text}`;
  const offset = left.text.length + separator.length;
  return {
    passageId: `${left.passageId}+${right.passageId}`,
    pageIndex: left.pageIndex,
    sectionTitle: left.sectionTitle,
    text,
    members: [...left.members, ...right.members.map((member) => ({ ...member, textStart: member.textStart + offset, textEnd: member.textEnd + offset }))],
    diagnostics: ['Joined two complete, nearby same-page and same-section method paragraphs; all original anchors remain independent.'],
  };
}

function selectMethodPassages(ranked: RankedEvidencePassage[], options: RetrievalSelectionOptions, perPageLimit: number): EvidencePassage[] {
  const readableRanked = ranked.map((item) => {
    // Keep the exact original quote in members while omitting a stranded PDF
    // word before a complete, self-contained method sentence.
    const prefix = /^([a-z]{2,16}\.)\s+(?=[A-Z])/.exec(item.passage.text)?.[0];
    if (!prefix || !/\b(?:we|our|the (?:model|dataset|system))\b.{0,100}\b(?:collect\w*|curat\w*|annotat\w*|construct\w*|train\w*|encod\w*|render\w*)\b/i.test(item.passage.text.slice(prefix.length))) return item;
    return { ...item, passage: { ...item.passage, text: item.passage.text.slice(prefix.length),
      members: item.passage.members.map((member) => ({ ...member, textStart: Math.max(0, member.textStart - prefix.length), textEnd: Math.max(0, member.textEnd - prefix.length) })),
      diagnostics: [...item.passage.diagnostics, 'Excluded a stranded leading PDF word from model-facing text; original member quote is unchanged.'] } };
  });
  const localPairs: RankedEvidencePassage[] = [];
  if (options.includeAdjacent) for (const left of readableRanked) for (const right of readableRanked) {
    const joined = joinedMethodNeighbour(left.passage, right.passage);
    if (joined) localPairs.push({ passage: joined, score: Math.max(left.score, right.score), scoreBreakdown: left.scoreBreakdown, diagnostics: joined.diagnostics as string[] });
  }
  const eligible = [...readableRanked, ...localPairs].map((item, order) => ({ ...item, order, quality: methodPassageQuality(item.passage), aspects: methodAspects(item.passage.text), steps: methodSteps(item.passage) }))
    .filter((item): item is typeof item & { quality: number } => item.quality !== undefined);
  const technicalModel = eligible.some((item) => item.aspects.has('representation'))
    && eligible.some((item) => item.aspects.has('training')) && eligible.some((item) => item.aspects.has('inference'));
  const datasetMethod = eligible.some(({ passage }) => /\b(?:dataset construction|benchmark construction|data engine|video collection)\b|数据集构建|数据引擎|视频采集/i.test(passage.sectionTitle))
    && !eligible.some(({ passage }) => /\b(?:model|architecture|representation|rendering)\b|模型|架构|表征|渲染/i.test(passage.sectionTitle));
  const modelAndEngine = eligible.some((item) => item.steps.has('image_encoding'))
    && eligible.some((item) => item.steps.has('prompt_encoding'))
    && eligible.some((item) => item.steps.has('data_engine'));
  const scalingStudy = eligible.some((item) => item.steps.has('matched_setup'))
    && eligible.some((item) => item.steps.has('allocation_fit'));
  const densityControl = eligible.some((item) => item.steps.has('density_growth'))
    && eligible.some((item) => item.steps.has('density_cleanup'))
    && eligible.some((item) => item.aspects.has('rasterization'));
  const relevantSteps: MethodStep[] = datasetMethod ? ['collection', 'collection_detail', 'annotation', 'annotation_detail', 'review', 'sample_scale', 'annotation_scale']
    : modelAndEngine ? ['image_encoding', 'prompt_encoding', 'decoding', 'data_engine', 'representation', 'training']
      : scalingStudy ? ['matched_setup', 'allocation_fit', 'allocation_equation', 'representation', 'training', 'inference']
        : densityControl ? ['representation', 'optimization', 'density_growth', 'density_cleanup', 'training', 'inference']
          : ['representation', 'optimization', 'training', 'inference'];
  const agenda: MethodStep[] = datasetMethod
    ? ['collection_detail', 'annotation_detail', 'review', 'sample_scale']
    : modelAndEngine ? ['image_encoding', 'prompt_encoding', 'decoding', 'data_engine']
      : scalingStudy ? ['matched_setup', 'allocation_fit', ...(eligible.some((item) => item.steps.has('allocation_equation')) ? ['allocation_equation' as const] : [])]
        : densityControl ? ['density_growth', 'density_cleanup'] : [];
  const selected: EvidencePassage[] = [];
  const selectedSet = new Set<EvidencePassage>();
  const selectedEvidenceIds = new Set<string>();
  const covered = new Map<MethodAspect, number>();
  const coveredSteps = new Map<MethodStep, number>();
  const perPage = new Map<number, number>();
  const tokens = new Map(eligible.map(({ passage }) => [passage, new Set(tokenizeForRetrieval(passage.text))]));
  while (selected.length < options.maxCandidates) {
    const requiredStep = agenda.shift();
    if (requiredStep && coveredSteps.has(requiredStep)) continue;
    let best: typeof eligible[number] | undefined;
    let bestScore = -Infinity;
    for (const item of eligible) {
      const passage = item.passage;
      if (requiredStep && !item.steps.has(requiredStep)) continue;
      if (selectedSet.has(passage) || passage.members.some((member) => selectedEvidenceIds.has(member.candidate.evidenceId))) continue;
      const pageCount = perPage.get(passage.pageIndex) ?? 0;
      const newSteps = [...item.steps].filter((step) => relevantSteps.includes(step) && !coveredSteps.has(step));
      const localSteps = new Set(selected.filter((prior) => prior.pageIndex === passage.pageIndex).flatMap((prior) => [...methodSteps(prior)]));
      const complementaryThird = perPageLimit === 2 && options.includeAdjacent && pageCount === 2
        && item.quality >= 10 && passage.text.length >= 110 && /[.!?。！？]$/.test(passage.text.trim())
        && [...item.steps].some((step) => !localSteps.has(step) && ['annotation', 'review', 'image_encoding', 'prompt_encoding', 'decoding', 'data_engine', 'optimization', 'inference'].includes(step));
      if (pageCount >= perPageLimit && !complementaryThird || pageCount >= perPageLimit + 1) continue;
      const terms = tokens.get(passage)!;
      let overlap = 0;
      for (const prior of selected) {
        const priorTerms = tokens.get(prior)!;
        let shared = 0;
        for (const term of terms) if (priorTerms.has(term)) shared += 1;
        overlap = Math.max(overlap, shared / Math.max(1, Math.min(terms.size, priorTerms.size)));
      }
      const newAspects = [...item.aspects].filter((aspect) => (covered.get(aspect) ?? 0) < 2);
      const diminishingCoverage = [...item.aspects].reduce((sum, aspect) => sum + (covered.has(aspect) ? 0.6 / covered.get(aspect)! : 0), 0);
      const neighbour = options.includeAdjacent && selected.some((prior) => prior.text.length < 260 && sameLocalNeighbour(prior, passage));
      // A neighbour can restore the next local step, but it cannot displace a
      // distinct method role solely because PDF.js emitted nearby text items.
      const adjacency = neighbour && newAspects.length ? 5 : 0;
      const peripheralCollection = technicalModel && item.aspects.has('collection')
        && !/\b(?:data engine|dataset construction|benchmark construction|video collection|annotation)\b|数据引擎|数据集构建|标注/i.test(passage.sectionTitle) ? 18 : 0;
      const peripheralTraining = technicalModel
        && /\b(?:train(?:ing)? on .{0,90}(?:tasks?|data|samples?)|tasks? derived from|synthetic dataset|training mixture)\b/i.test(passage.text)
        && !/\b(?:data engine|dataset construction|benchmark construction|annotation)\b/i.test(passage.sectionTitle) ? 7 : 0;
      const pageRepeat = (perPage.get(passage.pageIndex) ?? 0) > 0 ? 4 : 0;
      const sectionRepeat = !neighbour && selected.some((prior) => prior.pageIndex === passage.pageIndex && prior.sectionTitle === passage.sectionTitle) ? 5 : 0;
      const abstractRepeat = /\babstract\b|摘要/i.test(passage.sectionTitle) && selected.length > 0 ? 4 : 0;
      const score = Math.min(item.score, 20) * 0.1 + item.quality + Math.min(newAspects.length, 2) * 5
        + Math.min(newSteps.length, 2) * (datasetMethod || modelAndEngine || scalingStudy ? 8 : 4)
        + (requiredStep === 'matched_setup' && /\bmatched\b.{0,70}\b\d+\b.{0,90}\b(?:models?|decoders?|architectures?)\b/i.test(passage.text) ? 20 : 0)
        + (requiredStep === 'allocation_fit' && /\bIsoFLOP\b/i.test(passage.text) ? 40 : 0)
        + (requiredStep === 'image_encoding' && /\bpre.train\w*\b/i.test(passage.text) && /\bruns? once\b/i.test(passage.text) ? 14 : 0)
        + (requiredStep === 'prompt_encoding' && item.steps.has('decoding') ? 15 : 0)
        + diminishingCoverage + adjacency + (datasetMethod && hasSourceCollectionAction(passage.text) ? 18 : 0)
        - overlap * 7 - peripheralCollection - peripheralTraining - pageRepeat - sectionRepeat - abstractRepeat - (complementaryThird ? 3 : 0) - Math.max(0, selected.length - 2) * (newAspects.length || newSteps.length ? 0 : 1.5);
      if (score > bestScore || score === bestScore && item.order < (best?.order ?? Infinity)) { best = item; bestScore = score; }
    }
    if (!best || bestScore < -2) {
      if (requiredStep) continue;
      break;
    }
    selected.push(best.passage);
    selectedSet.add(best.passage);
    for (const member of best.passage.members) selectedEvidenceIds.add(member.candidate.evidenceId);
    perPage.set(best.passage.pageIndex, (perPage.get(best.passage.pageIndex) ?? 0) + 1);
    // One long overview must not claim every step it merely names.
    for (const aspect of [...best.aspects].slice(0, 2)) covered.set(aspect, (covered.get(aspect) ?? 0) + 1);
    for (const step of best.steps) coveredSteps.set(step, (coveredSteps.get(step) ?? 0) + 1);
  }
  return selected;
}

/** Passage-level diversity is intentionally simple: rank by joined prose,
 * cap any page, and never reopen individual fragment selection. */
export function selectRankedPassagesForPurpose(index: PassageRetrievalIndex, purpose: DetailedRetrievalPurpose, options: RetrievalSelectionOptions): EvidencePassage[] {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) throw new Error('maxCandidates must be a positive integer.');
  const perPageLimit = options.maxCandidatesPerPage ?? 2;
  if (!Number.isInteger(perPageLimit) || perPageLimit < 1) throw new Error('maxCandidatesPerPage must be a positive integer.');
  const perPage = new Map<number, number>();
  const selected: EvidencePassage[] = [];
  const ranked = rankPassagesForPurpose(index, purpose, index.passages.length);
  if (purpose === 'method') return selectMethodPassages(ranked, options, perPageLimit);
  const onPurpose = ranked.filter(({ passage }) => {
    if (purpose === 'problem_motivation') {
      const title = passage.sectionTitle;
      const inOpening = /\b(?:abstract|introduction|background)\b|摘要|引言|背景/i.test(title)
        || passage.pageIndex >= 0 && passage.pageIndex <= 4
          && !/\b(?:results?|experiments?|evaluation|discussion|conclusion|related work)\b|结果|实验|评测|讨论|结论|相关工作/i.test(title);
      const inPriorWork = /\b(?:related work|prior work)\b|相关工作/i.test(title);
      if (/\b(?:method|model architecture|dataset construction|data engine|annotation|quality review)\b|方法|架构|数据集构建|标注|质检/i.test(title)) return false;
      const directProblem = /\b(?:lack\w*|limit\w*|challeng\w*|fail\w*|insufficient|overlook\w*|neglect\w*|scarcity|difficult\w*|unable|cannot|costly|bottleneck|trade.off|quadratic|expensive)\b|\bnot\s+(?:yet\s+)?(?:been\s+)?systematically\s+(?:characteriz\w*|studied|evaluat\w*)\b|不足|局限|挑战|缺乏|难以|昂贵|瓶颈/i.test(passage.text);
      return (inOpening || inPriorWork) && directProblem;
    }
    if (purpose === 'experiments_ablations') {
      const category = passageCategory(passage, purpose);
      return !/\b(?:conclusions?|discussions?|related work)\b|结论|讨论|相关工作/i.test(passage.sectionTitle)
        && (category === 'result' || category === 'ablation'
          || category === 'analysis' && /\b(?:analysis|results?|evaluation)\b|分析|结果|评测/i.test(passage.sectionTitle)
            && /\b(?:improv\w*|declin\w*|decreas\w*|increas\w*|affect\w*)\b|提升|下降|变化/i.test(passage.text)
          || category === 'setup' && /\b(?:experiments?|evaluation|settings?|results?)\b|实验|评测|设置|结果/i.test(passage.sectionTitle));
    }
    if (purpose === 'relative_novelty') return passageCategory(passage, purpose) !== 'general'
      && (/\b(?:introduction|related work|background|method|approach)\b|引言|相关工作|背景|方法/i.test(passage.sectionTitle)
        || /\b(?:our work|our method|our benchmark|we distinguish|we differ|existing benchmarks)\b|本文|本方法|本基准/i.test(passage.text));
    return true;
  });
  let pool = onPurpose;
  const selectedCategories = new Set<string>();
  const selectedPassages = new Set<EvidencePassage>();
  const tokens = new Map(index.passages.map((passage) => [passage, new Set(tokenizeForRetrieval(passage.text))]));
  const maxOverlap = new Map<EvidencePassage, number>();
  const take = (result: RankedEvidencePassage) => {
    const passage = result.passage;
    selected.push(passage);
    selectedPassages.add(passage);
    perPage.set(passage.pageIndex, (perPage.get(passage.pageIndex) ?? 0) + 1);
    selectedCategories.add(passageCategory(passage, purpose));
    const prior = tokens.get(passage)!;
    for (const other of ranked) {
      const candidate = other.passage;
      if (selectedPassages.has(candidate)) continue;
      const current = tokens.get(candidate)!;
      const overlap = [...current].filter((term) => prior.has(term)).length / Math.max(1, Math.min(current.size, prior.size));
      maxOverlap.set(candidate, Math.max(maxOverlap.get(candidate) ?? 0, overlap));
    }
  };
  while (selected.length < options.maxCandidates) {
    let best: RankedEvidencePassage | undefined;
    let bestScore = -Infinity;
    for (const result of pool) {
      const passage = result.passage;
      if (selectedPassages.has(passage) || (perPage.get(passage.pageIndex) ?? 0) >= perPageLimit) continue;
      const category = passageCategory(passage, purpose);
      const overlap = maxOverlap.get(passage) ?? 0;
      const score = result.score - overlap * 3 + (category !== 'general' && !selectedCategories.has(category) ? 3 : 0);
      if (score > bestScore) { best = result; bestScore = score; }
    }
    if (!best) {
      if (pool !== ranked && purpose !== 'problem_motivation' && selected.length < Math.min(2, options.maxCandidates)) { pool = ranked; continue; }
      break;
    }
    take(best);
  }
  return selected;
}

function passageCategory(passage: EvidencePassage, purpose: DetailedRetrievalPurpose): string {
  const text = passage.text;
  const section = passage.sectionTitle;
  if (purpose === 'method') {
    if (/\b(?:gaussian|representation|covariance|embedding|encoder|attention)\b|高斯|表征|协方差|嵌入|编码|注意力/i.test(text) && /\b(?:parameter|represent|initialize|model|feature|window|token|prompt)\b|参数|表示|初始化|特征|窗口|提示/i.test(text)) return 'representation';
    if (/\b(?:distill\w*|teacher|student|densif\w*|clone|prun\w*|optimi[sz]\w*)\b|蒸馏|教师|学生|密度控制|克隆|剪枝|优化/i.test(text)) return 'optimization';
    if (/\b(?:rasteriz\w*|render\w*|draft model|decod\w*|inference)\b|光栅|渲染|草稿模型|解码|推理/i.test(text)) return 'inference';
    if (/\b(?:collect(?:ed|ion)?|curat\w*|annotat\w*|construct\w*|assembl\w*|sample\w*|filter\w*|label\w*|generate\w*|partition\w*|split)\b|收集|采集|标注|构建|筛选|生成|划分/i.test(text)) return 'construction';
    if (/\b(?:first|then|next|finally|stage|step|module|encode\w*|decode\w*|train\w*|infer\w*|optimi[sz]\w*|input|output)\b|首先|然后|步骤|模块|编码|解码|训练|推理|输入|输出/i.test(text)) return 'procedure';
    if (/\b(?:protocol|metric|evaluat\w*|task|question.answer)\b|评测|指标|任务|问答/i.test(text) && /\b(?:dataset|benchmark|video|image|model)\b|数据集|基准|视频|图像|模型/i.test(section + ' ' + text)) return 'protocol';
  }
  if (purpose === 'experiments_ablations') {
    if (/\b(?:ablat\w*|w\/o|without|remov\w*|replac\w*|variant|component|module)\b|消融|移除|替换/i.test(text)) return 'ablation';
    if (/\b(?:outperform\w*|surpass\w*|improv\w*|achiev\w*|attain\w*|declin\w*|decreas\w*|increas\w*|compar\w*)\b|提升|下降|优于|相比/i.test(text) && /\d/.test(text)) return 'result';
    if (/\b(?:duration|length|short|medium|long|subtitle|audio|resolution|fps|latency|speed)\b|时长|短视频|长视频|字幕|音频|分辨率|速度|延迟/i.test(text) && /\b(?:analysis|performance|accuracy|effect|gap|change|degrad\w*|compar\w*)\b|分析|表现|准确率|变化|下降|比较/i.test(text)) return 'analysis';
    if (/\b(?:dataset|benchmark|baseline|backbone|metric|evaluat\w*|test set)\b|数据集|基准|模型|指标|评测/i.test(text) && /\b(?:use|on|with|against|include|consist)\b|使用|包含|采用/i.test(text)) return 'setup';
  }
  if (purpose === 'relative_novelty') {
    if (/\b(?:unlike|compared with|in contrast|different from|whereas|distinguishes from|existing benchmarks)\b|相对|相比|不同于/i.test(text)) return 'contrast';
    if (/\b(?:prior|previous|existing)\b.*\b(?:lack|limit|fail|cannot|only)\b|已有.*(?:缺乏|限制|不足)/i.test(text)) return 'prior_gap';
  }
  return 'general';
}

function queryTokens(definition: QueryDefinition): string[] {
  return [...new Set([...definition.terms, ...(definition.supplementaryTerms ?? [])].flatMap(tokenizeForRetrieval))];
}

function inverseDocumentFrequency(recordCount: number, documentFrequency: number): number {
  return Math.log(1 + ((recordCount - documentFrequency + 0.5) / (documentFrequency + 0.5)));
}

/**
 * Ranks only pre-existing candidates. Section and slot signals are deliberately
 * weak bonuses after lexical evidence, never admission requirements.
 */
export function rankEvidenceForPurpose(
  index: RetrievalIndex,
  purpose: DetailedRetrievalPurpose,
  maxCandidates = 12,
): RankedEvidenceCandidate[] {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error('maxCandidates must be a positive integer.');
  if (index.records.length === 0) return [];
  const definition = QUERY_DEFINITIONS[purpose];
  const terms = queryTokens(definition);
  const supplementaryTokens = new Set((definition.supplementaryTerms ?? []).flatMap(tokenizeForRetrieval));
  const documentFrequency = new Map(terms.map((term) => [term, 0]));
  for (const record of index.records) for (const term of terms) if (record.termFrequency.has(term)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = index.records.reduce((total, record) => total + record.length, 0) / index.records.length;
  const k1 = 1.2;
  const b = 0.75;
  const ranked = index.records.map((record, sourceIndex) => {
    let lexical = 0;
    let supplementaryLexical = 0;
    const matchedSupplementaryTokens = new Set<string>();
    const matchedTokens: string[] = [];
    for (const term of terms) {
      const frequency = record.termFrequency.get(term) ?? 0;
      if (!frequency) continue;
      matchedTokens.push(term);
      const denominator = frequency + k1 * (1 - b + b * (record.length / averageLength));
      const contribution = inverseDocumentFrequency(index.records.length, documentFrequency.get(term) ?? 0) * ((frequency * (k1 + 1)) / denominator);
      if (supplementaryTokens.has(term)) {
        supplementaryLexical += contribution;
        matchedSupplementaryTokens.add(term);
      } else {
        lexical += contribution;
      }
    }
    // A single word such as "benchmark" or "evaluation" is often merely an
    // experiment mention. Treat supplementary cues as construction evidence
    // only when a passage supplies a small constellation of them.
    if (matchedSupplementaryTokens.size >= 2) lexical += supplementaryLexical * 0.35;
    const sectionBoost = includesAny(record.sectionTokens, definition.sectionTerms) ? 0.35 : 0;
    const slotBoost = definition.slots.includes(record.candidate.slot) ? 0.15 : 0;
    const fallback = lexical === 0;
    return {
      candidate: record.candidate,
      score: lexical + sectionBoost + slotBoost,
      scoreBreakdown: { lexical, sectionBoost, slotBoost, matchedTokens },
      diagnostics: [
        fallback ? 'No purpose query token matched; retained as readable global-body fallback.' : `Matched ${matchedTokens.length} local purpose token${matchedTokens.length === 1 ? '' : 's'}.`,
        sectionBoost ? 'Automatic/unknown section title matched a weak section prior.' : 'No section prior matched; global retrieval remains eligible.',
        slotBoost ? 'Section-derived slot added a weak prior only.' : 'No slot prior matched.',
      ],
      sourceIndex,
    };
  });
  return ranked
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .slice(0, maxCandidates)
    .map(({ sourceIndex: _sourceIndex, ...result }) => result);
}

type CandidatePosition = { pageIndex: number; sourceOrder: number; ledgerOrder: number };

function positionForCandidate(candidate: EvidenceCandidate, ledgerOrder: number): CandidatePosition {
  // Evidence IDs created by the ledger carry the original PDF.js page/item
  // coordinate. The ledger-order fallback keeps deterministic behavior for
  // synthetic/test ledgers without manufacturing a PDF location.
  const match = /:p(\d+):i(\d+)$/.exec(candidate.evidenceId);
  return match
    ? { pageIndex: Number(match[1]), sourceOrder: Number(match[2]), ledgerOrder }
    : { pageIndex: ledgerOrder, sourceOrder: ledgerOrder, ledgerOrder };
}

function sectionKey(candidate: EvidenceCandidate): string {
  return candidate.section.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function readableLength(value: string): number {
  return Array.from(value).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

/**
 * Turns a purpose ranking into a bounded, source-preserving stage order. It
 * never creates excerpts or alters anchors: every returned value is one of
 * the index's original ledger candidates.
 */
export function selectRankedEvidenceForPurpose(
  index: RetrievalIndex,
  purpose: DetailedRetrievalPurpose,
  options: RetrievalSelectionOptions,
): EvidenceCandidate[] {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) throw new Error('maxCandidates must be a positive integer.');
  const maxCandidatesPerPage = options.maxCandidatesPerPage ?? 2;
  if (!Number.isInteger(maxCandidatesPerPage) || maxCandidatesPerPage < 1) throw new Error('maxCandidatesPerPage must be a positive integer.');
  if (index.records.length === 0) return [];

  const ranked = rankEvidenceForPurpose(index, purpose, index.records.length).map((item) => item.candidate);
  const originalOrder = new Map(index.records.map((record, index) => [record.candidate, index]));
  const positions = new Map(index.records.map((record, index) => [record.candidate, positionForCandidate(record.candidate, index)]));
  const selected: EvidenceCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedQuotes = new Set<string>();
  const perPage = new Map<number, number>();

  const add = (candidate: EvidenceCandidate): boolean => {
    const position = positions.get(candidate);
    const quoteKey = candidate.quote.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!position || !quoteKey || selectedIds.has(candidate.evidenceId) || selectedQuotes.has(quoteKey)) return false;
    if ((perPage.get(position.pageIndex) ?? 0) >= maxCandidatesPerPage || selected.length >= options.maxCandidates) return false;
    // At most two immediately adjacent text items may be selected. This is a
    // diversity cap, not a claim that PDF.js source order is reading order.
    const adjacentSelected = selected.filter((item) => {
      const other = positions.get(item);
      return other?.pageIndex === position.pageIndex && Math.abs(other.sourceOrder - position.sourceOrder) === 1;
    }).length;
    if (adjacentSelected >= 2) return false;
    selected.push(candidate);
    selectedIds.add(candidate.evidenceId);
    selectedQuotes.add(quoteKey);
    perPage.set(position.pageIndex, (perPage.get(position.pageIndex) ?? 0) + 1);
    return true;
  };

  for (const candidate of ranked) {
    if (!add(candidate)) continue;
    if (!options.includeAdjacent || selected.length >= options.maxCandidates || readableLength(candidate.quote) > 180) continue;
    const position = positions.get(candidate)!;
    const neighbour = index.records
      .map((record) => record.candidate)
      .filter((item) => item !== candidate && sectionKey(item) === sectionKey(candidate))
      .filter((item) => {
        const other = positions.get(item)!;
        return other.pageIndex === position.pageIndex && Math.abs(other.sourceOrder - position.sourceOrder) === 1;
      })
      .sort((left, right) => (originalOrder.get(left)! - originalOrder.get(candidate)!) - (originalOrder.get(right)! - originalOrder.get(candidate)!))[0];
    if (neighbour) add(neighbour);
  }
  return selected;
}

export function retrievalQueryDefinition(purpose: DetailedRetrievalPurpose): Readonly<QueryDefinition> {
  return QUERY_DEFINITIONS[purpose];
}
