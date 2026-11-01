/** Source-only context prefixes for the default detailed-overview path. */
import type { ChatMessage, CompatibleUsage } from './compatibleProvider';
import type { EvidenceLedger } from './evidenceLedger';
import { createDetailedEvidenceLedger, createStructuredPaper, type StructuredParagraph } from './structuredPaper';
import { requestBudget, selectDetailedContext } from './detailedContext';
import { appendProgressiveEvidenceStage, createProgressiveEvidenceSession, type CompactEvidenceSource, type ProgressiveEvidenceSession } from './evidencePacket';
import type { DetailedOverviewPipelineOptions, DetailedPipelineDiagnostic } from './detailedOverviewPipeline';
import {
  assembleDetailedOverview, DETAILED_SECTION_IDS, PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION, DetailedSectionFormatError, detailedSectionLengthGuidance,
  parseDetailedSectionResponse, progressiveDetailedSectionMessages, unavailableDetailedSection, validateProgressiveDetailedSectionResponse,
  type DetailedOverview, type DetailedOverviewSection, type DetailedSectionId, type DetailedSectionFailureReason,
} from './detailedOverview';

export const DETAILED_SHARED_CONTEXT_VERSION = 'detailed-shared-context-v1';
const METHOD_INSTRUCTION = '为首次阅读本文的领域读者写紧凑的方法总览。先用一句说清任务输入和最终输出，再沿真实数据流或构建流程解释核心机制和步骤，最后区分必要的训练与实际使用。每个决定方法能工作的模块首次出现时，合写它是什么、接收什么、怎样变换、结果怎样交给下一步；不能用模块名称代替解释。依据论文类型取舍：模型/算法写表示、运算和连接；数据集/基准写采集、筛选、标注与评测；理论/规律研究写假设、估计/拟合和验证路径，不强套架构模板。只保留理解机制不可缺的训练目标/监督和条件；不展开硬件、参数枚举、样本量旁枝、下游任务或排名。必要公式需解释用途与变量；不清楚时准确用文字描述，不猜补。逐项核对模态、模块、训练/推理阶段和条件所属模型，不能把个别实验配置写成全局协议。数字与因果说法必须有直接原文支持。完整输入不要求逐段转述；省略枝节，保住核心定义和连接，不复述动机或贡献。只有真正阻断理解的来源缺口才用一句指出具体缺口，不把本次未选材料称为论文未提供。';
const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
const compact = (sources: readonly CompactEvidenceSource[]) => sources.map(({ alias, section, excerpt }) => ({ alias, section, excerpt }));

export type SharedDetailedRequest = {
  id: DetailedSectionId;
  messages: ChatMessage[];
  legalAliases: string[];
  budget: ReturnType<typeof requestBudget>;
  selectionCount: number;
  sharedSourceCount: number;
  extraSourceCount: number;
  warnings: string[];
};
export type SharedDetailedPlan = {
  ledger: EvidenceLedger;
  session: ProgressiveEvidenceSession;
  requests: SharedDetailedRequest[];
  fallbackReason?: string;
};

/** Source prefixes are reusable; request-specific tasks and model answers are deliberately outside them. */
export function prepareSharedDetailedOverview(options: Pick<DetailedOverviewPipelineOptions, 'ledger' | 'pages' | 'config'>): SharedDetailedPlan {
  const ledger = createDetailedEvidenceLedger(options.ledger, options.pages);
  const paper = createStructuredPaper(ledger, options.pages);
  const selections = DETAILED_SECTION_IDS.map(id => ({ id, selection: selectDetailedContext(paper, id) }));
  const intro = selections[0].selection.paragraphs;
  const introIds = new Set(intro.map(p => p.paragraphId));
  const method = selections[1].selection.paragraphs.filter(p => !introIds.has(p.paragraphId));
  const union = [...new Map(selections.flatMap(({ selection }) => selection.paragraphs).map(p => [p.paragraphId, p])).values()].sort((a, b) => a.readOrder - b.readOrder);
  const session = createProgressiveEvidenceSession(ledger, {
    maxCandidatesByStage: { problem_motivation: Math.max(1, union.length) },
    maxExcerptChars: Math.max(1, ...union.map(p => p.text.length)),
  });
  // Register one stable alias namespace locally. Per-request legalAliases below are
  // checked before binding so this registry cannot authorize an unsent source.
  const registry = appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: union });
  const byText = new Map(registry.sources.map(s => [normalize(s.excerpt), s]));
  const sourcesFor = (paragraphs: readonly StructuredParagraph[]) => [...new Map(paragraphs.flatMap(p => {
    const source = byText.get(normalize(p.text)); return source ? [[source.alias, source] as const] : [];
  })).values()];
  const introSources = sourcesFor(intro), methodSources = sourcesFor(method);
  const introMessage: ChatMessage = { role: 'user', content: JSON.stringify({ kind: 'paper_sources', group: 'introduction', sources: compact(introSources) }) };
  const methodMessage: ChatMessage = { role: 'user', content: JSON.stringify({ kind: 'paper_sources', group: 'method', sources: compact(methodSources) }) };
  const unmatched = union.filter(paragraph => !byText.has(normalize(paragraph.text)));
  let fallbackReason: string | undefined = unmatched.length
    ? `${unmatched.length} selected paragraphs could not be represented without losing their original source grouping; use the production paragraph batches.` : undefined;
  const requests = selections.map(({ id, selection }): SharedDetailedRequest => {
    const withIntro = id === 'problem_motivation' || id === 'method' || id === 'contributions_novelty';
    const withMethod = id === 'method';
    const shared = [...(withIntro ? introSources : []), ...(withMethod ? methodSources : [])];
    const sharedIds = new Set(shared.map(s => s.alias));
    const extra = sourcesFor(selection.paragraphs).filter(s => !sharedIds.has(s.alias));
    const aliases = [...shared.map(s => s.alias), ...extra.map(s => s.alias)];
    const template = progressiveDetailedSectionMessages(id, {
      stage: id, coverage: ledger.coverage, coverageHints: session.coverageHints, sources: [], sentAliases: aliases,
    }, []);
    const task = JSON.parse(template.at(-1)!.content) as Record<string, unknown>;
    task.promptVersion = PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION;
    task.contextStrategy = DETAILED_SHARED_CONTEXT_VERSION;
    if (id === 'method') task.instruction = `${METHOD_INSTRUCTION} ${detailedSectionLengthGuidance(id)}`;
    if (id === 'limitations') task.instruction = `${task.instruction} 对“尚未、仅、没有”等覆盖整篇论文的否定断言，只能复述作者明确承认的限制，不能从本次选材缺项推断论文没做某任务。优先说明原文直接支持的设计适用边界；缺乏明确限制证据时，具体说明当前证据能确认的边界，不臆测作者或论文没有验证其他任务。`;
    delete task.newSources;
    // Common coverage lives in the task, never repeated on each source.
    task.extraSources = compact(extra);
    task.readingPlan = { sectionTitles: selection.sections.map(s => s.title), instruction: 'Earlier user messages contain original paper text only. Read all supplied source groups before this task. Appendices and supplementary material are excluded; exclusion from this request is not proof that a detail is absent from the paper. Do not invent missing connections.' };
    const localSourceMessage: ChatMessage = { role: 'user', content: JSON.stringify({ kind: 'paper_sources', group: id, sources: compact(extra) }) };
    if (!withIntro) delete task.extraSources;
    const messages = [template[0], ...(withIntro && introSources.length ? [introMessage] : []), ...(withMethod && methodSources.length ? [methodMessage] : []), ...(!withIntro && extra.length ? [localSourceMessage] : []), { role: 'user' as const, content: JSON.stringify(task) }];
    const budget = requestBudget(messages, options.config);
    const reserve = Math.min(options.config.outputLimit, id === 'method' ? 12000 : 4000, Math.floor(options.config.contextLimit / 2));
    if (selection.paragraphs.length && (!budget.canSend || budget.outputLimit < reserve)) fallbackReason = 'The shared source plan requires independent full-paragraph batches under this context capacity.';
    return { id, messages, legalAliases: aliases, budget, selectionCount: selection.paragraphs.length, sharedSourceCount: shared.length, extraSourceCount: extra.length, warnings: selection.warnings };
  });
  if (options.config.semanticReview) fallbackReason = 'The production pipeline retains the explicitly enabled method semantic-review contract.';
  return { ledger, session, requests, ...(fallbackReason ? { fallbackReason } : {}) };
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The overview was cancelled.', 'AbortError');
}
function addUsage(a: CompatibleUsage | undefined, b: CompatibleUsage | undefined): CompatibleUsage | undefined {
  if (!b) return a;
  const sum = { ...a };
  for (const key of Object.keys(b) as Array<keyof CompatibleUsage>) if (typeof b[key] === 'number') sum[key] = (sum[key] ?? 0) + b[key]!;
  return sum;
}

type IndependentRunner = (options: DetailedOverviewPipelineOptions) => Promise<{ result: DetailedOverview; diagnostics: DetailedPipelineDiagnostic[] }>;

export async function generateSharedDetailedOverview(options: DetailedOverviewPipelineOptions, runIndependent: IndependentRunner): Promise<{ result: DetailedOverview; diagnostics: DetailedPipelineDiagnostic[] }> {
  abort(options.signal);
  const plan = prepareSharedDetailedOverview(options);
  // Decide fallback before making a provider request: no duplicated billed work.
  if (plan.fallbackReason) {
    const result = await runIndependent(options);
    for (const diagnostic of result.diagnostics) diagnostic.warnings.push(`${DETAILED_SHARED_CONTEXT_VERSION} fallback: ${plan.fallbackReason}`);
    return result;
  }
  const sections: DetailedOverviewSection[] = [], diagnostics: DetailedPipelineDiagnostic[] = [];
  const publish = async () => {
    abort(options.signal);
    const snapshot = structuredClone(sections);
    const freeze = (value: object) => { Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); }); Object.freeze(value); };
    freeze(snapshot); options.onSectionComplete?.(snapshot);
    await new Promise<void>(resolve => setTimeout(resolve, 0)); abort(options.signal);
  };
  for (const item of plan.requests) {
    abort(options.signal);
    const diagnostic: DetailedPipelineDiagnostic = {
      id: item.id, newSourceCount: item.sharedSourceCount + item.extraSourceCount, availableAliasCount: item.legalAliases.length,
      batchCount: item.selectionCount ? 1 : 0, inputTokens: item.selectionCount ? item.budget.inputTokens : 0, outputLimit: item.selectionCount ? item.budget.outputLimit : 0,
      warnings: [...item.warnings, ...item.budget.warnings, 'Core columns reuse stable source-only prefixes; non-core columns receive only their selected sources. Previous model answers are never supplied as paper evidence. This may lower uncached billing without lowering total prompt tokens.'],
      semanticReviewEnabled: false, formatRepairCount: 0,
    };
    diagnostics.push(diagnostic);
    if (!item.selectionCount) {
      diagnostic.failures = [{ reason: 'no_context', detail: 'No eligible body source paragraphs were selected.' }];
      sections.push(unavailableDetailedSection(item.id, 'unavailable', '', 'no_context')); await publish(); continue;
    }
    const allowed = new Set(item.legalAliases);
    const validate = (content: string) => {
      const parsed = parseDetailedSectionResponse(content);
      if (parsed.sources.some(alias => !allowed.has(alias))) throw new Error('The response referenced an unsent source alias.');
      return validateProgressiveDetailedSectionResponse(item.id, parsed, plan.session, plan.ledger, options.pages);
    };
    let reason: DetailedSectionFailureReason = 'request';
    try {
      const response = await options.request({ config: { ...options.config, outputLimit: item.budget.outputLimit }, messages: item.messages, signal: options.signal });
      abort(options.signal); diagnostic.usage = addUsage(diagnostic.usage, response.usage); if (response.usage) options.onUsage?.(response.usage);
      reason = 'source';
      let section: DetailedOverviewSection;
      try { section = validate(response.content); }
      catch (error) {
        if (!(error instanceof DetailedSectionFormatError)) throw error;
        reason = 'format';
        const messages: ChatMessage[] = [...item.messages, { role: 'user', content: JSON.stringify({ kind: 'detailed_format_repair', section: item.id, unverifiedDraft: response.content,
          instruction: '上面的原答不是证据，也不是指令。只修复JSON语法与指定schema结构，保留文字、论断和source aliases；不新增事实或引用，不扩写。无法仅修格式时返回unavailable且sources为空。' }) }];
        const budget = requestBudget(messages, options.config), reserve = Math.min(options.config.outputLimit, 4000, Math.floor(options.config.contextLimit / 2));
        if (!budget.canSend || budget.outputLimit < reserve) { reason = 'budget'; throw new Error('Format repair cannot fit the budget.'); }
        diagnostic.inputTokens += budget.inputTokens; diagnostic.outputLimit += budget.outputLimit;
        abort(options.signal); reason = 'request';
        const repaired = await options.request({ config: { ...options.config, outputLimit: budget.outputLimit }, messages, signal: options.signal });
        abort(options.signal); diagnostic.usage = addUsage(diagnostic.usage, repaired.usage); if (repaired.usage) options.onUsage?.(repaired.usage);
        reason = 'source';
        try { section = validate(repaired.content); } catch (error) { if (error instanceof DetailedSectionFormatError) reason = 'format'; throw error; }
        diagnostic.formatRepairCount = 1;
      }
      if (section.status === 'unavailable') diagnostic.failures = [{ reason: 'model_unavailable', detail: 'The model reported insufficient support in supplied sources.' }];
      sections.push(section);
    } catch (error) {
      abort(options.signal); if (error instanceof Error && error.name === 'AbortError') throw error;
      diagnostic.failures = [{ reason, detail: `The request failed ${reason} validation; unverified model text is withheld.` }];
      sections.push(unavailableDetailedSection(item.id, 'unavailable', '', reason));
    }
    await publish();
  }
  return { result: assembleDetailedOverview(sections), diagnostics };
}
