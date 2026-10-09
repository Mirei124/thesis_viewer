import { describe, expect, it } from 'vitest';
import type { EvidenceCandidate, EvidenceLedger } from './evidenceLedger';
import { createPassageRetrievalIndex, createRetrievalIndex, LOCAL_RETRIEVAL_VERSION, rankEvidenceForPurpose, rankPassagesForPurpose, selectRankedEvidenceForPurpose, selectRankedPassagesForPurpose, tokenizeForRetrieval } from './retrievalIndex';
import { createEvidencePassages, EVIDENCE_PASSAGE_VERSION, type EvidencePassage } from './evidencePassages';
import { appendProgressiveEvidenceStage, createProgressiveEvidenceSession, resolveProgressiveEvidenceAliases } from './evidencePacket';
import { progressiveDetailedSectionMessages } from './detailedOverview';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';

function candidate(id: string, quote: string, sectionTitle = 'Unknown', slot: EvidenceCandidate['slot'] = 'unclassified_body'): EvidenceCandidate {
  return { evidenceId: id, blockId: id, quote, slot, normalizedStart: 0, normalizedEnd: quote.length, precision: 'block', section: { title: sectionTitle, confidence: sectionTitle === 'Unknown' ? 'unknown' : 'automatic' }, coverage: 'full-text', qualityWarnings: [] };
}

function ledger(candidates: EvidenceCandidate[]): EvidenceLedger {
  return { version: 'pdf-evidence-ledger-v1', documentVersion: 'test-document', coverage: 'full-text', candidates, excluded: { referencesBlockCount: 0, unreliableBlockCount: 0, emptyBlockCount: 0 }, diagnostics: [] };
}

function anchoredPages(source: EvidenceLedger): PageExtraction[] {
  const grouped = new Map<number, PdfPageTextBlock[]>();
  for (const item of source.candidates) {
    const match = /:p(\d+):i(\d+)$/.exec(item.evidenceId)!;
    const pageIndex = Number(match[1]);
    const normalized = normalizePdfTextItem(item.quote);
    const block: PdfPageTextBlock = { blockId: item.blockId, documentVersion: source.documentVersion, extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder: Number(match[2]),
      rawText: item.quote, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false,
      anchor: { pageIndex, quote: item.quote, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' }, qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
    grouped.set(pageIndex, [...(grouped.get(pageIndex) ?? []), block]);
  }
  return [...grouped].map(([pageIndex, blocks]) => ({ pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' }));
}

describe('local lexical retrieval index', () => {
  it('recovers a density cleanup step from a fragmented PDF passage without losing its source anchors', () => {
    const originals = [
      candidate('test-document:pdf-evidence-ledger-v1:p4:i133', ', allowing us to go from sparse to dense Gaussians. After optimization warm-up (see Sec. 7.1),'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i134', 'we densify every 100 iterations and remove any Gaussians that are essentially transparent, i.e., with'),
    ];
    const passage: EvidencePassage = { passageId: 'cleanup', pageIndex: 4, sectionTitle: 'Density Control',
      text: originals.map((item) => item.quote).join(' '),
      members: originals.map((item) => ({ candidate: item, textStart: 0, textEnd: item.quote.length })), diagnostics: [] };
    const index = createPassageRetrievalIndex({ version: EVIDENCE_PASSAGE_VERSION, documentVersion: 'test-document', passages: [passage], diagnostics: [] });
    expect(index.passages[0].text).toBe('After optimization warm-up (see Sec. 7.1), we densify every 100 iterations and remove any Gaussians that are essentially transparent');
    expect(index.passages[0].members.map((member) => member.candidate.evidenceId)).toEqual(originals.map((item) => item.evidenceId));
  });
  it('places SAM prompt-encoder operations, mask-decoder flow and the data engine in five actual method sources', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p1:i81', 'ambiguity-aware. Surprisingly, we find that a simple design satisfies all three constraints: a powerful image encoder computes an image embedding, a prompt encoder embeds prompts, and then the two information sources are combined in a lightweight mask decoder that predicts segmentation masks. We refer to this model as the Segment Anything Model, or SAM (see Fig. 1b).', '3. What', 'method_overview'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i91', 'Intuitively, our pre-training task endows the model with the ability to respond appropriately to any prompt at inference time, and thus downstream tasks can be solved by engineering appropriate prompts.', '2. Segment Anything Task', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i33', 'We next describe the Segment Anything Model for promptable segmentation. SAM has three components: an image encoder, a prompt encoder, and a mask decoder. We describe these components at a high level here.', '3. Segment Anything Model', 'method_overview'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i43', 'Motivated by scalability and powerful pretraining methods, we use an MAE pre-trained Vision Transformer (ViT) minimally adapted to process high resolution inputs.', '3. Segment Anything Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i45', 'The image encoder runs once per image and can be applied prior to prompting the model.', '3. Segment Anything Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i63', 'We represent points and boxes by positional encodings summed with learned embeddings for each prompt type and free-form text with a text encoder. Dense prompts (', '3. Segment Anything Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i64', 'i.e', '3. Segment Anything Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i65', '., masks) are embedded using convolutions and summed element-wise with the image embedding.', '3. Segment Anything Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i69', 'The mask decoder efficiently maps the image embedding, prompt embeddings, and an output token to a mask.', '3. Segment Anything Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i135', 'The data engine has three stages: (1) model-assisted manual annotation, (2) a semi-automatic stage with automatically predicted masks and model-assisted annotation, and (3) a fully automatic stage in which the model generates masks without annotator input.', '4. Segment Anything Data Engine', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p5:i0', 'At the start of this stage, SAM was trained using public segmentation datasets. After sufficient annotation, SAM was retrained using only newly annotated masks.', '4. Segment Anything Data Engine', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p9:i0', 'We visualize representative edge maps and compare qualitative results against ground truth annotations.', '7. Zero-Shot Transfer Experiments', 'main_result'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source, { targetChars: 520, maxChars: 1500 }));
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: [] });
    const ordered = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true });
    const packet = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: ordered });
    const visible = packet.sources.map((item) => item.excerpt).join(' ');
    expect(visible).toContain('points and boxes by positional encodings');
    expect(visible).toContain('MAE pre-trained Vision Transformer');
    expect(visible).toContain('image encoder runs once per image');
    expect(visible).toContain('masks) are embedded using convolutions and summed element-wise with the image embedding');
    expect(visible).toContain('mask decoder efficiently maps the image embedding, prompt embeddings, and an output token to a mask');
    expect(visible).toContain('mask decoder that predicts segmentation masks');
    expect(visible).toContain('data engine has three stages');
    expect(packet.sources).toHaveLength(5);
    expect(ordered.slice(0, 5).filter((item) => item.pageIndex === 4).length).toBeLessThanOrEqual(3);
    const encoder = ordered.find((item) => item.text.includes('MAE pre-trained Vision Transformer'))!;
    expect(encoder.members.map((item) => item.candidate.evidenceId)).toEqual([
      'test-document:pdf-evidence-ledger-v1:p4:i43', 'test-document:pdf-evidence-ledger-v1:p4:i45',
    ]);
    const encoderAlias = packet.sources.find((item) => item.excerpt.includes('MAE pre-trained Vision Transformer'))!.alias;
    expect(resolveProgressiveEvidenceAliases(session, [encoderAlias], source, anchoredPages(source)).map((item) => item.evidenceId)).toEqual(encoder.members.map((item) => item.candidate.evidenceId));
    const promptDecoderAlias = packet.sources.find((item) => item.excerpt.includes('points and boxes by positional encodings'))!.alias;
    expect(resolveProgressiveEvidenceAliases(session, [promptDecoderAlias], source, anchoredPages(source)).map((item) => item.evidenceId)).toEqual([
      'test-document:pdf-evidence-ledger-v1:p4:i63', 'test-document:pdf-evidence-ledger-v1:p4:i64',
      'test-document:pdf-evidence-ledger-v1:p4:i65', 'test-document:pdf-evidence-ledger-v1:p4:i69',
    ]);
    expect(packet.sources.every((item) => item.excerpt.length <= 1500)).toBe(true);
  });

  it('sends Video-MME collection, three-question annotation, independent review and both dataset counts', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p1:i13', 'analysis. As exemplified in Figure 1, we meticulously curate a dataset of 900 videos across various scenarios, and annotate 2,700 high-quality multiple-choice questions.', '1. Introduction', 'contribution'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i18', 'coverage across diverse video types, we first establish a domain hierarchy for sourcing raw videos from YouTube. We identify key domains and 30 finely-grained video categories. For each category, we collect videos with varying duration lengths, including short (', '3.1. Dataset Construction', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i47', 'Following the collection of raw video data, we annotate the videos with high-quality question-answer pairs. Each annotator views the full video and creates three relevant questions, each accompa-', '3.1. Dataset Construction', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i48', 'nied by four candidate options, contributing to a total of 2,700 QA pairs.', '3.1. Dataset Construction', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i69', 'To guarantee quality, we conduct a rigorous manual review process. Each QA pair is examined by a different annotator to verify that the language is clear and precise, candidate options are logically consistent, and the designated correct answer is appropriate. We filter out pairs answerable solely from the textual question.', '3.1. Dataset Construction', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p6:i0', 'Existing models fix the number of input frames, causing long-video information loss.', '5. Discussions', 'author_limitation'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source, { targetChars: 520, maxChars: 1500 }));
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: [] });
    const ordered = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true });
    const packet = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: ordered });
    const visible = packet.sources.map((item) => item.excerpt).join(' ');
    expect(visible).toContain('domain hierarchy for sourcing raw videos');
    expect(visible).toContain('collect videos with varying duration lengths');
    expect(visible).toContain('different annotator to verify');
    expect(visible).toContain('three relevant questions, each accompanied by four candidate options, contributing to a total of 2,700 QA pairs');
    expect(visible).toContain('900 videos');
    expect(visible).not.toContain('analysis. As exemplified');
    expect(visible).not.toContain('accompa-');
    expect(visible).not.toContain('Existing models fix');
    expect(ordered.slice(0, 5).filter((item) => item.pageIndex === 3).length).toBe(3);
    expect(packet.sources).toHaveLength(4);
    expect(packet.sources.every((item) => item.excerpt.length <= 1500)).toBe(true);
    const qaAlias = packet.sources.find((item) => item.excerpt.includes('three relevant questions'))!.alias;
    expect(resolveProgressiveEvidenceAliases(session, [qaAlias], source, anchoredPages(source)).map((item) => item.evidenceId)).toEqual([
      'test-document:pdf-evidence-ledger-v1:p3:i47', 'test-document:pdf-evidence-ledger-v1:p3:i48',
    ]);
  });
  it('uses a short same-page, same-section neighbour only when it adds a method step', () => {
    const make = (id: string, quote: string, pageIndex: number, sectionTitle: string): EvidencePassage => {
      const original = candidate(`test-document:pdf-evidence-ledger-v1:p${pageIndex}:i${id}`, quote, sectionTitle, 'method_step');
      return { passageId: id, pageIndex, sectionTitle, text: quote, members: [{ candidate: original, textStart: 0, textEnd: quote.length }], diagnostics: [] };
    };
    const first = make('0', 'We build a model architecture with image and prompt encoders to represent each input.', 0, '3. Methods');
    const local = make('1', 'We use prompt features to decode output masks through a lightweight decoder at inference.', 0, '3. Methods');
    const remote = make('0', 'We use prompt features to decode output masks through a lightweight decoder at inference.', 1, '3. Methods');
    const wrongSection = make('2', 'We use prompt features to decode output masks through a lightweight decoder at inference.', 0, '4. Results');
    const index = createPassageRetrievalIndex({ version: EVIDENCE_PASSAGE_VERSION, documentVersion: 'test-document', passages: [first, remote, wrongSection, local], diagnostics: [] });
    const plain = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 2, maxCandidatesPerPage: 2, includeAdjacent: false });
    const joined = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 2, maxCandidatesPerPage: 2, includeAdjacent: true });
    expect(plain[0]).toBe(first);
    expect(plain[1]).toBe(remote);
    expect(joined[1]).toBe(local);
    expect(joined).not.toContain(wrongSection);
  });
  it('does not merge short architecture passages across a page or section', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p4:i43', 'We use a pretrained Vision Transformer to encode high resolution images.', 'Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i45', 'The image encoder runs once per image before prompting.', 'Data Engine', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p5:i47', 'The image encoder runs once per image before prompting.', 'Model', 'method_step'),
    ]);
    const ordered = selectRankedPassagesForPurpose(createPassageRetrievalIndex(createEvidencePassages(source)), 'method', { maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true });
    expect(ordered.every((passage) => !passage.passageId.includes('+'))).toBe(true);
  });

  it('recovers an encoder-free scaling motivation and matched study steps in actual staged sources', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p0:i0', 'Although encoder-free multimodal models show initial feasibility, their scaling behavior has not been systematically characterized.', 'Unknown', 'problem'),
      candidate('test-document:pdf-evidence-ledger-v1:p0:i2', 'We conduct a controlled scaling study of encoder-free and encoder-based models with the same sparse decoder ladder, data mixture, optimization setup, and visual-token granularity.', 'Unknown', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p2:i0', 'MLLMs on a matched ladder of 11 sparse MoE language models with 1.1B to 44B total parameters, sharing the same data mixture, optimization setup, and visual-token granularity.', 'Methods', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i0', 'We estimate compute-optimal allocation for both encoder-free and encoder-based models using IsoFLOP profiles. At each budget we fit loss against model parameters and data tokens.', 'Scaling Laws', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p7:i0', 'We probe the decoder internals using attention over visual tokens, layerwise representation evolution, and expert routing to trace where visual encoding occurs.', 'Internal Mechanisms', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p8:i0', 'We anticipate future models will improve visual understanding through additional training.', 'Conclusion', 'author_limitation'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source));
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    const problem = appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: selectRankedPassagesForPurpose(index, 'problem_motivation', { maxCandidates: 24, maxCandidatesPerPage: 2 }) });
    expect(problem.sources.some((item) => item.excerpt.includes('not been systematically characterized'))).toBe(true);
    const method = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true }) });
    const visible = method.sources.map((item) => item.excerpt).join(' ');
    expect(visible).toContain('matched ladder of 11 sparse MoE');
    expect(visible).toContain('using IsoFLOP profiles');
    expect(visible).toContain('expert routing');
    expect(visible).not.toContain('We anticipate future models');
    expect(method.sources.length).toBeLessThanOrEqual(5);
  });
  it('sends joined Video-MME annotation and review rules in the actual method packet without Discussions', () => {
    // Short, source-order-preserving fragments of the paper's QA review prose.
    const items = [
      candidate('doc:pdf-evidence-ledger-v1:p1:i0', 'Existing video benchmarks lack diverse durations and input modalities, limiting reliable assessment of long-form understanding.', '1. Introduction', 'problem'),
      candidate('doc:pdf-evidence-ledger-v1:p3:i10', 'Following the collection of raw video data, we annotate the videos with high-quality question-answer pairs using a multiple-choice format.', '3.1. Dataset Construction', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p3:i69', 'To guarantee the quality of our dataset, we conduct a rigorous manual review process. First, each', '3.1. Dataset Construction', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p3:i70', 'QA pair undergoes examination by a different annotator to', '3.1. Dataset Construction', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p3:i71', 'verify that (i) the language expression is clear and precise;', '3.1. Dataset Construction', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p3:i72', '(ii) the question is answerable with logically consistent candidate options, and the designated correct answer is appropriate. Furthermore, we filter out QA pairs that can be answered solely from textual questions.', '3.1. Dataset Construction', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p6:i0', 'Ideally, for videos of varying lengths models should sample frames at a fixed fps. Existing models fix the number of frames and lose long-video information.', '5. Discussions', 'author_limitation'),
    ];
    const source = ledger(items);
    const passages = createEvidencePassages(source, { targetChars: 520, maxChars: 1500 });
    const index = createPassageRetrievalIndex(passages);
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: selectRankedPassagesForPurpose(index, 'problem_motivation', { maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true }) });
    const ordered = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 24, maxCandidatesPerPage: 2, includeAdjacent: true });
    const increment = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: ordered });
    const review = increment.sources.find((item) => item.excerpt.includes('rigorous manual review process'));
    expect(review?.excerpt).toContain('logically consistent candidate options');
    expect(review?.excerpt).toContain('answered solely from textual questions');
    expect(increment.sources.map((item) => item.excerpt).join(' ')).not.toContain('fixed fps');
    expect(increment.sources.length).toBeLessThanOrEqual(5);
    expect(increment.sources.every((item) => item.excerpt.length <= 1500)).toBe(true);
    const pages: PageExtraction[] = [1, 3, 6].map((pageIndex) => {
      const blocks: PdfPageTextBlock[] = items.filter((item) => item.evidenceId.includes(`:p${pageIndex}:`)).map((item) => {
        const normalized = normalizePdfTextItem(item.quote);
        const sourceOrder = Number(/:i(\d+)$/.exec(item.evidenceId)![1]);
        return { blockId: item.blockId, documentVersion: 'test-document', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder,
          rawText: item.quote, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
          rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false,
          anchor: { pageIndex, quote: item.quote, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' },
          qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
      });
      return { pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' };
    });
    expect(resolveProgressiveEvidenceAliases(session, [review!.alias], source, pages).map((item) => item.evidenceId)).toEqual(items.slice(2, 6).map((item) => item.evidenceId));
  });
  it('covers MiMo architecture, RL teachers, on-policy distillation and decoding before peripheral web data', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p5:i0', 'We configure the model with sliding window attention and global attention layers using a 128-token window under a 5:1 hybrid ratio.', 'Model Architecture', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p8:i0', 'The MTP block uses a small dense FFN and sliding window attention; in post-training its head is replicated for speculative decoding.', 'Model Architecture', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p12:i0', 'We train domain-specialized teacher models through independent RL optimization on agentic and non-agentic tasks after SFT.', 'Post-Training', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p13:i0', 'On-policy distillation uses dense token-level rewards from teacher logits as the student learns from its own distribution.', 'Post-Training', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p16:i0', 'To improve web development code generation, we build a synthetic dataset with rendered videos and a multimodal verifier for additional training data.', 'Post-Training', 'method_step'),
    ]);
    const selected = selectRankedPassagesForPurpose(createPassageRetrievalIndex(createEvidencePassages(source)), 'method', { maxCandidates: 24, maxCandidatesPerPage: 2 });
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: [] });
    const sent = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: selected }).sources.map((item) => item.excerpt).join(' ');
    expect(sent).toContain('128-token window');
    expect(sent).toContain('agentic and non-agentic');
    expect(sent).toContain('teacher logits');
    expect(sent).toContain('speculative decoding');
  });

  it('keeps core data-engine construction when a segmentation model also has architecture, training and decoding', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p1:i0', 'We use an image encoder and a prompt encoder to produce features for the segmentation model.', 'Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p2:i0', 'We train the model with ambiguity-aware masks sampled from prompts during supervised learning.', 'Training', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i0', 'Our mask decoder combines the image embedding and prompt embedding to predict several valid masks.', 'Model', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i0', 'We construct the dataset using a three-stage data engine: model-assisted manual annotation, semi-automatic collection, and fully automatic collection.', 'Data Engine', 'method_step'),
    ]);
    const selected = selectRankedPassagesForPurpose(createPassageRetrievalIndex(createEvidencePassages(source)), 'method', { maxCandidates: 24 });
    const visible = selected.slice(0, 5).map((item) => item.text).join(' ');
    expect(visible).toContain('image encoder');
    expect(visible).toContain('mask decoder');
    expect(visible).toContain('three-stage data engine');
  });

  it('recovers 3DGS opening motivation and its SfM, density-control and renderer method flow', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p0:i0', 'Achieving high visual quality still requires neural networks that are costly to train and render, while faster methods trade off speed for quality. At 1080p resolution no current method achieves real-time display rates.', 'Unknown', 'problem'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i0', 'The input is images and cameras calibrated by SfM, which produces sparse points from which we create 3D Gaussians with covariance and opacity.', 'Unknown', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p4:i0', 'We clone small Gaussians in under-reconstructed regions and split large Gaussians into smaller ones during adaptive density control.', 'Unknown', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p5:i0', 'We design a tile-based rasterizer that sorts projected Gaussians by depth and accumulates visibility-aware colors for each pixel.', 'Unknown', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p8:i0', 'We use the same hyperparameter configuration for all experiments and report GPU settings in supplemental material.', 'Results and Evaluation', 'experimental_setup'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source));
    const problem = selectRankedPassagesForPurpose(index, 'problem_motivation', { maxCandidates: 24 });
    expect(problem[0]?.text).toContain('costly to train and render');
    const method = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 24 });
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: problem });
    const sent = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: method }).sources.map((item) => item.excerpt).join(' ');
    expect(sent).toContain('calibrated by SfM');
    expect(sent).toContain('clone small Gaussians');
    expect(sent).toContain('tile-based rasterizer');
    expect(sent).not.toContain('supplemental material');
  });

  it('keeps prior-model fixed-fps discussion out of the paper motivation input', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p0:i0', 'The potential of models to process sequential visual data is insufficiently explored, highlighting the lack of a comprehensive assessment.', 'Unknown', 'problem'),
      candidate('test-document:pdf-evidence-ledger-v1:p1:i0', 'Existing benchmarks lack diversity in video type and duration, limiting evaluation across temporal contexts.', 'Introduction', 'problem'),
      candidate('test-document:pdf-evidence-ledger-v1:p9:i0', 'Ideally, models should sample video frames at a fixed fps. However, existing models fix the number of input frames.', '4.3 Analysis', 'author_limitation'),
    ]);
    const selected = selectRankedPassagesForPurpose(createPassageRetrievalIndex(createEvidencePassages(source)), 'problem_motivation', { maxCandidates: 4 });
    const visible = selected.map((item) => item.text).join(' ');
    expect(visible).toContain('lack of a comprehensive assessment');
    expect(visible).toContain('Existing benchmarks lack diversity');
    expect(visible).not.toContain('fixed fps');
  });

  it('selects explicit prior-work dimensions and measured comparisons ahead of generic section openings', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p0:i0', 'Our work distinguishes from existing benchmarks through two features: 1) broader input types; 2) controlled duration coverage.', 'Unknown'),
      candidate('test-document:pdf-evidence-ledger-v1:p1:i0', 'In this section, we evaluate a variety of models and begin by outlining settings and quantitative results.', 'Experiments', 'evaluation_scope'),
      candidate('test-document:pdf-evidence-ledger-v1:p2:i0', 'With frames alone, Model A attains 75% accuracy, surpassing Model B by 3.1 percentage points on the same benchmark.', 'Quantitative Results', 'main_result'),
      candidate('test-document:pdf-evidence-ledger-v1:p3:i0', 'Compared with frames alone, subtitles improve accuracy by 10.1% for long inputs on the same evaluation set.', 'Analysis', 'main_result'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source));
    const novelty = selectRankedPassagesForPurpose(index, 'relative_novelty', { maxCandidates: 4 });
    const experiments = selectRankedPassagesForPurpose(index, 'experiments_ablations', { maxCandidates: 6 });
    expect(novelty[0].text).toContain('distinguishes from existing benchmarks');
    expect(experiments.map((item) => item.text).join(' ')).toContain('75% accuracy');
    expect(experiments.map((item) => item.text).join(' ')).toContain('10.1% for long inputs');
    expect(experiments.map((item) => item.text).join(' ')).not.toContain('begin by outlining settings');
  });

  it('does not fill the method stage with result and ablation passages when the page cap is reached', () => {
    const source = ledger([
      candidate('test-document:pdf-evidence-ledger-v1:p0:i0', 'The encoder produces image features for the proposed architecture and training process.', 'Encoder', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p0:i2', 'The decoder maps prompt features to a mask with an efficient attention module.', 'Decoder', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p0:i4', 'The model uses an optimization stage for learning the parameters of this architecture.', 'Training', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p1:i0', 'Without the decoder module, accuracy decreases by 3.2 points on the same dataset.', 'Ablation', 'ablation'),
      candidate('test-document:pdf-evidence-ledger-v1:p2:i0', 'The model improves accuracy by 2.1 points compared with a previous baseline.', 'Results', 'main_result'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source));
    const selected = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 3, maxCandidatesPerPage: 1 });
    expect(selected).toHaveLength(1);
    expect(selected[0].pageIndex).toBe(0);
    expect(selected.map((item) => item.text).join(' ')).not.toMatch(/accuracy|ablation/i);
  });

  it('keeps distinct representation, density-control and rendering prose in the five-source method cap', () => {
    const source = ledger([
      ...Array.from({ length: 8 }, (_, index) => candidate(`test-document:pdf-evidence-ledger-v1:p${index}:i0`, 'This paper proposes a method and model framework for efficient scene reconstruction with high visual quality.', 'Introduction', 'contribution')),
      candidate('test-document:pdf-evidence-ledger-v1:p10:i0', 'The scene representation initializes anisotropic Gaussian covariance parameters from sparse SfM points.', 'Scene Representation', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p11:i0', 'During optimization, adaptive density control clones small Gaussians, splits large Gaussians, and prunes low-opacity elements.', 'Density Control', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p12:i0', 'At inference, a tile-based rasterizer sorts visible Gaussians and renders the image with alpha compositing.', 'Rendering', 'method_step'),
    ]);
    const index = createPassageRetrievalIndex(createEvidencePassages(source));
    const selected = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 5 });
    const visible = selected.map((item) => item.text).join(' ');
    expect(visible).toContain('anisotropic Gaussian covariance');
    expect(visible).toContain('clones small Gaussians');
    expect(visible).toContain('tile-based rasterizer');
  });

  it('selects construction steps and setup, measured result and ablation within stage budgets', () => {
    const generic = Array.from({ length: 9 }, (_, index) => candidate(`test-document:pdf-evidence-ledger-v1:p${index}:i0`, 'Video evaluation methods use benchmark datasets and models to report experimental performance across many tasks and settings.', 'Introduction', 'contribution'));
    const source = ledger([
      ...generic,
      candidate('test-document:pdf-evidence-ledger-v1:p10:i0', 'We collect videos from YouTube and divide them into short, medium, and long durations before constructing the benchmark categories and tasks.', 'Video Collection', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p11:i0', 'After collecting raw video data, human annotators watch each video and write question-answer pairs; a second annotator checks whether each answer is supported.', 'Question-Answer Annotation', 'method_step'),
      candidate('test-document:pdf-evidence-ledger-v1:p12:i0', 'The evaluation protocol uses accuracy on 900 videos and compares model A with open-source models across short, medium and long video groups.', 'Experimental Setup', 'experimental_setup'),
      candidate('test-document:pdf-evidence-ledger-v1:p13:i0', 'Model A achieves 75.7% overall accuracy, outperforming the compared open-source video models under the same benchmark protocol.', 'Main Results', 'main_result'),
      candidate('test-document:pdf-evidence-ledger-v1:p14:i0', 'Without subtitles, the model accuracy decreases by 8.2 points; this ablation isolates the contribution of subtitle information on the same evaluation set.', 'Ablation Study', 'ablation'),
    ]);
    const passages = createEvidencePassages(source).passages;
    const index = createPassageRetrievalIndex({ version: EVIDENCE_PASSAGE_VERSION, documentVersion: 'test-document', passages, diagnostics: [] });
    const method = selectRankedPassagesForPurpose(index, 'method', { maxCandidates: 5 });
    const experiments = selectRankedPassagesForPurpose(index, 'experiments_ablations', { maxCandidates: 6 });
    expect(method.map((item) => item.text).join(' ')).toContain('human annotators watch each video');
    expect(method.map((item) => item.text).join(' ')).toContain('divide them into short, medium');
    expect(experiments.map((item) => item.text).join(' ')).toContain('900 videos');
    expect(experiments.map((item) => item.text).join(' ')).toContain('75.7%');
    expect(experiments.map((item) => item.text).join(' ')).toContain('Without subtitles');
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 960 });
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: [] });
    const methodInput = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: method });
    appendProgressiveEvidenceStage(session, 'contributions_novelty', { orderedPassages: [] });
    const experimentInput = appendProgressiveEvidenceStage(session, 'experiments_ablations', { orderedPassages: experiments });
    const visible = [...methodInput.sources, ...experimentInput.sources].map((item) => item.excerpt).join(' ');
    expect(visible).toContain('human annotators watch each video');
    expect(visible).toContain('75.7%');
    expect(visible).toContain('Without subtitles');
    expect(new Set([...methodInput.sources, ...experimentInput.sources].map((item) => item.alias)).size).toBe(methodInput.sources.length + experimentInput.sources.length);
    expect(experimentInput.sentAliases).toEqual([...methodInput.sentAliases, ...experimentInput.sources.map((item) => item.alias)]);
    expect(progressiveDetailedSectionMessages('experiments_ablations', experimentInput, [])[1].content).toContain('Without subtitles');
  });

  it('ranks readable method prose above title, author, and numeric fragments', () => {
    const source = ledger([
      candidate('title', 'A Compact Framework for Reliable Reading'),
      candidate('authors', 'Ada Lovelace, Grace Hopper, Alan Turing'),
      candidate('numbers', '1, 2, 3 ...'),
      candidate('method', 'We propose a training method whose architecture combines local evidence retrieval and calibrated decoding.', '2 Methods', 'method_overview'),
    ]);
    const index = createRetrievalIndex(source);
    expect(index.candidateCount).toBe(1);
    expect(rankEvidenceForPurpose(index, 'method')[0].candidate.evidenceId).toBe('method');
  });

  it('uses section and slot as weak boosts rather than hard gates', () => {
    const source = ledger([
      candidate('wrong-section', 'Our method uses a novel architecture and training procedure for the proposed model.', 'Introduction', 'problem'),
      candidate('method-heading-context', 'This paragraph describes unrelated observations without the requested terms.', 'Methods', 'method_overview'),
    ]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'method');
    expect(results.map((result) => result.candidate.evidenceId)).toEqual(['wrong-section', 'method-heading-context']);
    expect(results[0].scoreBreakdown.lexical).toBeGreaterThan(0);
    expect(results[1].scoreBreakdown.sectionBoost).toBeGreaterThan(0);
  });

  it('tokenizes English words and Chinese uni/bi-grams for deterministic matches', () => {
    expect(tokenizeForRetrieval('Training 方法框架')).toEqual(expect.arrayContaining(['training', '方', '法', '框', '架', '方法', '法框', '框架']));
    const source = ledger([candidate('cn', '我们提出一种新的方法框架，并进行训练和推理。', '未知章节')]);
    const result = rankEvidenceForPurpose(createRetrievalIndex(source), 'method')[0];
    expect(result.candidate.evidenceId).toBe('cn');
    expect(result.scoreBreakdown.lexical).toBeGreaterThan(0);
  });

  it('retrieves dataset and benchmark construction prose as a legitimate method, ahead of generic evaluation text', () => {
    const source = ledger([
      candidate('generic-evaluation', 'We report accuracy on several evaluation settings.', 'Experiments', 'evaluation_scope'),
      candidate('video-mme-method', 'Video-MME collects 900 videos with subtitles and audio, uses expert annotation to construct QA pairs, and evaluates models by accuracy.', 'Dataset Construction', 'experimental_setup'),
      candidate('heading', '3 Dataset Construction', 'Dataset Construction', 'method_overview'),
    ]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'method');
    expect(results[0].candidate.evidenceId).toBe('video-mme-method');
    expect(results[0].scoreBreakdown.matchedTokens).toEqual(expect.arrayContaining(['annotation', 'qa', 'video', 'audio']));
  });

  it('retains model architecture and training prose as a first-class method signal', () => {
    const source = ledger([
      candidate('benchmark-only', 'The benchmark reports evaluation accuracy across tasks.', 'Experiments', 'evaluation_scope'),
      candidate('model-method', 'Our framework uses a model architecture with a staged training and inference algorithm.', 'Methods', 'method_overview'),
    ]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'method');
    expect(results[0].candidate.evidenceId).toBe('model-method');
    expect(results[0].scoreBreakdown.matchedTokens).toEqual(expect.arrayContaining(['framework', 'training', 'inference', 'architecture']));
  });

  it('falls back to globally readable body text when sections are unknown or query terms do not match', () => {
    const source = ledger([candidate('body-a', 'This paper reports a controlled study with careful observations.'), candidate('body-b', 'A second readable paragraph provides additional discussion.')]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'limitations');
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.diagnostics.some((note) => note.includes('global-body fallback')))).toBe(true);
  });

  it('is deterministic, bounded, and reports no candidates when no readable body exists', () => {
    const source = ledger([candidate('heading', '1. Methods', 'Methods', 'method_overview'), candidate('tiny', '...')]);
    const empty = createRetrievalIndex(source);
    expect(empty.version).toBe(LOCAL_RETRIEVAL_VERSION);
    expect(empty.candidateCount).toBe(0);
    expect(empty.diagnostics[0]).toMatch(/No eligible readable/);
    expect(rankEvidenceForPurpose(empty, 'method')).toEqual([]);

    const populated = createRetrievalIndex(ledger([candidate('a', 'We propose an approach with a method and training phase.'), candidate('b', 'We evaluate benchmark performance in experiments.')]));
    expect(rankEvidenceForPurpose(populated, 'method', 1)).toEqual(rankEvidenceForPurpose(populated, 'method', 1));
    expect(() => rankEvidenceForPurpose(populated, 'method', 0)).toThrow(/positive integer/);
  });

  it('converts rankings into a bounded, diverse stage order and may retain one adjacent body paragraph', () => {
    const source = ledger([
      candidate('doc:pdf-evidence-ledger-v1:p1:i0', 'We propose a compact method.', 'Methods', 'method_overview'),
      candidate('doc:pdf-evidence-ledger-v1:p1:i1', 'The training procedure optimizes the model with local retrieval.', 'Methods', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p1:i2', 'A third method paragraph explains implementation details.', 'Methods', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p2:i0', 'Our experiments evaluate the method on benchmark tasks.', 'Experiments', 'evaluation_scope'),
    ]);
    const selected = selectRankedEvidenceForPurpose(createRetrievalIndex(source), 'method', { maxCandidates: 3, includeAdjacent: true });
    expect(selected.map((item) => item.evidenceId)).toEqual(expect.arrayContaining([
      'doc:pdf-evidence-ledger-v1:p1:i0', 'doc:pdf-evidence-ledger-v1:p1:i1',
    ]));
    expect(selected.filter((item) => item.evidenceId.includes(':p1:'))).toHaveLength(2);
    expect(new Set(selected.map((item) => item.quote)).size).toBe(selected.length);
  });

  it('ranks joined passage prose, not its individually fragmented PDF.js members', () => {
    const source = ledger([
      candidate('doc:pdf-evidence-ledger-v1:p1:i0', 'We propose a frame-', 'Methods', 'method_overview'),
      candidate('doc:pdf-evidence-ledger-v1:p1:i1', 'work with training and inference stages for reliable decoding.', 'Methods', 'method_step'),
    ]);
    const passages = createEvidencePassages(source, { minimumChars: 1 });
    const ranked = rankPassagesForPurpose(createPassageRetrievalIndex(passages), 'method');
    expect(ranked[0].passage.text).toContain('framework with training');
    expect(ranked[0].passage.members).toHaveLength(2);
  });
});
