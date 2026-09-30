import { describe, expect, it } from 'vitest';
import { inlineEvidenceAccessibleName, inlineEvidenceLabel, inlineEvidenceParts } from './inlineEvidence';

describe('inline evidence text', () => {
  it('links only aliases verified for the current block and leaves unknown mentions plain', () => {
    expect(inlineEvidenceParts('方法见 E007，未知 E099。', [{ alias: 'E007', evidenceIds: ['local-7'] }])).toEqual([
      { kind: 'text', value: '方法见 ' }, { kind: 'source', alias: 'E007', evidenceIds: ['local-7'] },
      { kind: 'text', value: '，未知 ' }, { kind: 'text', value: 'E099' }, { kind: 'text', value: '。' },
    ]);
  });

  it('appends verified aliases not mentioned in prose without inventing E numbers', () => {
    expect(inlineEvidenceParts('贡献概述。', [{ alias: 'S03', evidenceIds: ['local-3'] }])).toEqual([
      { kind: 'text', value: '贡献概述。' }, { kind: 'text', value: ' ' }, { kind: 'source', alias: 'S03', evidenceIds: ['local-3'] },
    ]);
  });

  it('keeps every verified member behind a single alias', () => {
    expect(inlineEvidenceParts('E007', [{ alias: 'E007', evidenceIds: ['first', 'second'] }])).toEqual([
      { kind: 'source', alias: 'E007', evidenceIds: ['first', 'second'] },
    ]);
  });

  it('renders a repeated alias once per sentence, including for three-line summaries', () => {
    const refs = [{ alias: 'S01', evidenceIds: ['first', 'second'] }];
    const parts = inlineEvidenceParts('S01 与 S01 共同支持。下一句 S01。', refs);
    expect(parts.filter((part) => part.kind === 'source')).toEqual([
      { kind: 'source', alias: 'S01', evidenceIds: ['first', 'second'] },
      { kind: 'source', alias: 'S01', evidenceIds: ['first', 'second'] },
    ]);
  });

  it('consumes model-supplied brackets around verified aliases without doubled citation brackets', () => {
    expect(inlineEvidenceParts('机制见 [E001]，未知 [E099]。', [{ alias: 'E001', evidenceIds: ['source'] }])).toEqual([
      { kind: 'text', value: '机制见 ' }, { kind: 'source', alias: 'E001', evidenceIds: ['source'] },
      { kind: 'text', value: '，未知 ' }, { kind: 'text', value: '[E099]' }, { kind: 'text', value: '。' },
    ]);
  });

  it('never links an alias with no verified candidate', () => {
    expect(inlineEvidenceParts('E007', [{ alias: 'E007', evidenceIds: [] }])).toEqual([{ kind: 'text', value: 'E007' }]);
  });

  it('formats verified E and S aliases as compact numbered citations without changing their identities', () => {
    const detailed = { kind: 'source' as const, alias: 'E007', evidenceIds: ['local-7'] };
    const threeLine = { ...detailed, alias: 'S01' };
    expect(inlineEvidenceLabel(detailed)).toBe('[7]');
    expect(inlineEvidenceLabel(threeLine)).toBe('[1]');
    expect(inlineEvidenceAccessibleName(detailed, 2, 'exact')).toBe('Go to Detailed overview source E007 on page 3; exact precision');
    expect(inlineEvidenceAccessibleName(threeLine, 0, 'block')).toBe('Go to Three-line overview source S01 on page 1; block precision');
  });

  it('labels a joined passage once while retaining member navigation metadata', () => {
    const parts = inlineEvidenceParts('E007', [{ alias: 'E007', evidenceIds: ['first', 'second'] }]);
    const sources = parts.filter((part) => part.kind === 'source');
    expect(sources.map(inlineEvidenceLabel)).toEqual(['[7]']);
    expect(inlineEvidenceAccessibleName(sources[0], 4, 'page', 2)).toContain('E007, passage part 2 of 2 on page 5; page precision');
  });
});
