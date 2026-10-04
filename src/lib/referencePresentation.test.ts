import { describe, expect, it } from 'vitest';
import { referencePresentation } from './referencePresentation';

describe('display-only local reference parsing', () => {
  it('extracts an actual Video-MME entry without treating backreference pages as a venue', () => {
    expect(referencePresentation('[66] Shukang Yin, Chaoyou Fu, Sirui Zhao, Ke Li, Xing Sun, Tong Xu, and Enhong Chen. A survey on multimodal large language models. National Science Review , 2024. 1, 3')).toEqual({
      title: 'A survey on multimodal large language models',
      authors: 'Shukang Yin, Chaoyou Fu, Sirui Zhao, Ke Li, Xing Sun, Tong Xu, and Enhong Chen.',
      year: '2024', venue: 'National Science Review',
    });
  });
  it('does not split author initials or et al at a sentence boundary', () => {
    expect(referencePresentation('[25] Junnan Li, Dongxu Li, Silvio Savarese, and Steven C. H. Hoi. Blip-2: Bootstrapping language-image pre-training with frozen image encoders and large language models. In ICML , 2023. 3')?.title).toBe('Blip-2: Bootstrapping language-image pre-training with frozen image encoders and large language models');
    expect(referencePresentation('[1] A. B. Smith, C. Jones, et al. Learning useful visual representations. In CVPR, 2020. 1, 3')?.authors).toBe('A. B. Smith, C. Jones, et al.');
  });
  it('keeps decimal punctuation and title questions distinct from venues', () => {
    expect(referencePresentation('[55] Gemini Team, et al. Gemini 1.5: Unlocking multimodal understanding. ArXiv preprint, 2024. 1')?.title).toBe('Gemini 1.5: Unlocking multimodal understanding');
    expect(referencePresentation('[40] Yuan Liu, et al. Is your model an all-around player? ArXiv preprint, 2023. 3')).toMatchObject({ title: 'Is your model an all-around player?', venue: 'ArXiv preprint' });
  });
  it('recognizes explicit quoted titles and avoids inventing missing venues', () => {
    expect(referencePresentation('[1] Jane Smith and John Doe. “Learning from long videos.” In CVPR, 2024. 2')).toMatchObject({ title: 'Learning from long videos', venue: 'In CVPR' });
    expect(referencePresentation('[48] OpenAI. GPT-4V(ision) system card, 2023. 2, 6')).toEqual({ title: 'GPT-4V(ision) system card', authors: 'OpenAI.', year: '2023' });
  });
  it.each([
    '[1] Jane Smith. A complete title. In CVPR',
    '[1] John Smith. A useful model. It works well, 2024.',
    '[1] Jane Smith. John Doe. A useful model. In CVPR, 2024.',
    '[1] Jane Smith. A title. In CVPR, 2024. Supplementary Material 7. Settings',
    '[1] Jane Smith. A title. In CVPR, 2024. [2] John Doe. Another title.',
    '[1] A survey on models. Jane Smith and John Doe. In CVPR, 2024.',
    '[1] Jane Smith. A title. 2024. We conduct evaluations on four models.',
    '[1] Jane Smith. Title fragment [2] Model datasets. In CVPR, 2024.',
    '[1] D. Broken- name. A valid looking title. In CVPR, 2024.',
    '[1] Jane Smith. “Broken quotation title. In CVPR, 2024.',
  ])('falls back for missing, merged, reordered, or contaminated entries: %s', (raw) => {
    expect(referencePresentation(raw)).toBeNull();
  });
});
