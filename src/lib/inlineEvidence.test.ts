import { describe, expect, it } from 'vitest';
import { inlineEvidenceAccessibleName, inlineEvidenceLabel, inlineEvidenceParts } from './inlineEvidence';

describe('inline evidence text', () => {
  it('links only aliases verified for the current block and leaves unknown mentions plain', () => {
    expect(inlineEvidenceParts('方法见 E007，未知 E099。', [{ alias: 'E007', evidenceIds: ['local-7'] }])).toEqual([
      { kind: 'text', value: '方法见 ' }, { kind: 'source', alias: 'E007', evidenceId: 'local-7', member: 1, memberCount: 1 },
      { kind: 'text', value: '，未知 ' }, { kind: 'text', value: 'E099' }, { kind: 'text', value: '。' },
    ]);
  });

  it('appends verified aliases not mentioned in prose without inventing E numbers', () => {
    expect(inlineEvidenceParts('贡献概述。', [{ alias: 'S03', evidenceIds: ['local-3'] }])).toEqual([
      { kind: 'text', value: '贡献概述。' }, { kind: 'text', value: ' ' }, { kind: 'source', alias: 'S03', evidenceId: 'local-3', member: 1, memberCount: 1 },
    ]);
  });

  it('keeps every verified member of a joined passage independently reachable', () => {
    expect(inlineEvidenceParts('E007', [{ alias: 'E007', evidenceIds: ['first', 'second'] }])).toEqual([
      { kind: 'source', alias: 'E007', evidenceId: 'first', member: 1, memberCount: 2 },
      { kind: 'text', value: ' ' },
      { kind: 'source', alias: 'E007', evidenceId: 'second', member: 2, memberCount: 2 },
    ]);
  });

  it('never links an alias with no verified candidate', () => {
    expect(inlineEvidenceParts('E007', [{ alias: 'E007', evidenceIds: [] }])).toEqual([{ kind: 'text', value: 'E007' }]);
  });

  it('formats verified E and S aliases as compact numbered citations without changing their identities', () => {
    const detailed = { kind: 'source' as const, alias: 'E007', evidenceId: 'local-7', member: 1, memberCount: 1 };
    const threeLine = { ...detailed, alias: 'S01' };
    expect(inlineEvidenceLabel(detailed)).toBe('[7]');
    expect(inlineEvidenceLabel(threeLine)).toBe('[1]');
    expect(inlineEvidenceAccessibleName(detailed, 2, 'exact')).toBe('Go to Detailed overview source E007 on page 3; exact precision');
    expect(inlineEvidenceAccessibleName(threeLine, 0, 'block')).toBe('Go to Three-line overview source S01 on page 1; block precision');
  });

  it('numbers all independent passage members under the original alias', () => {
    const parts = inlineEvidenceParts('E007', [{ alias: 'E007', evidenceIds: ['first', 'second'] }]);
    const sources = parts.filter((part) => part.kind === 'source');
    expect(sources.map(inlineEvidenceLabel)).toEqual(['[7.1]', '[7.2]']);
    expect(inlineEvidenceAccessibleName(sources[1], 4, 'page')).toContain('E007, passage part 2 of 2 on page 5; page precision');
  });
});
