import { describe, expect, it } from 'vitest';
import { OVERVIEW_LANGUAGE_POLICY } from './overviewLanguagePolicy';
import { THREE_LINE_OVERVIEW_PROMPT_VERSION, threeLineOverviewMessages } from './threeLineOverview';
import { DETAILED_OVERVIEW_PROMPT_VERSION, DETAILED_SECTION_IDS, PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION, detailedSectionMessages, progressiveDetailedSectionMessages } from './detailedOverview';
import { createEvidencePacket, createProgressiveEvidenceSession, appendProgressiveEvidenceStage } from './evidencePacket';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';

// Request construction, not model output: no paid provider calls or fragile text replacement.
const ledger = pdfEvidenceLedgerFromPages([], 'language-policy-test', []);

function expectLanguagePolicy(content: string) {
  expect(content).toContain(OVERVIEW_LANGUAGE_POLICY);
  expect(content).not.toMatch(/Write Chinese only/i);
  expect(content).toContain('narrative and connective prose in Chinese');
  expect(content).toContain('proper names and domain-specific technical terminology');
  expect(content).toContain('do not translate them into Chinese');
  expect(content).toContain('append Chinese translations in parentheses');
  expect(content).toContain('only when they occur in the sources');
  expect(content).toContain('do not back-translate Chinese-only source terms');
}

describe('overview source-language terminology requests', () => {
  it('applies terminology preservation to the three-line request alongside its evidence and JSON contract', () => {
    const messages = threeLineOverviewMessages(createEvidencePacket(ledger, { purpose: 'three_line' }));
    expectLanguagePolicy(messages[0].content);
    expect(messages[0].content).toContain('Return exactly three');
    expect(messages[0].content).toContain('Return JSON only');
    expect(JSON.parse(messages[1].content).promptVersion).toBe(THREE_LINE_OVERVIEW_PROMPT_VERSION);
  });

  it.each(DETAILED_SECTION_IDS)('applies the same policy to standalone %s without altering section scope', (section) => {
    const messages = detailedSectionMessages(section, createEvidencePacket(ledger, { purpose: section }));
    expectLanguagePolicy(messages[0].content);
    expect(messages[0].content).toContain(`only the ${section} section`);
    expect(messages[0].content).toContain('Return JSON only');
    expect(JSON.parse(messages[1].content)).toMatchObject({ section, promptVersion: DETAILED_OVERVIEW_PROMPT_VERSION });
  });

  it('retains one stable terminology policy across all six progressive turns and preserves their history', () => {
    const session = createProgressiveEvidenceSession(ledger);
    let history: ReturnType<typeof progressiveDetailedSectionMessages> = [];
    let system = '';
    for (const section of DETAILED_SECTION_IDS) {
      const increment = appendProgressiveEvidenceStage(session, section);
      const messages = progressiveDetailedSectionMessages(section, increment, history);
      expectLanguagePolicy(messages[0].content);
      expect(messages[0].content).toContain('unverified drafts');
      expect(messages.slice(1, -1)).toEqual(history);
      if (system) expect(messages[0].content).toBe(system);
      system = messages[0].content;
      expect(JSON.parse(messages.at(-1)!.content)).toMatchObject({ section, promptVersion: PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION });
      history = [...messages.slice(1), { role: 'assistant', content: '{"status":"unavailable","text":"资料不足","sources":[]}' }];
    }
  });
});
