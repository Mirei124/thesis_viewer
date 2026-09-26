import { describe, expect, it } from 'vitest';

import { parseTranslationResponse, translationMessages } from './translationResponse';

describe('translation response contract', () => {
  it('accepts only the exact JSON response shape', () => {
    expect(parseTranslationResponse('{"translation":"译文","uncertainty":null}')).toEqual({ translation: '译文', uncertainty: null });
    expect(() => parseTranslationResponse('{"translation":"x"}')).toThrow(/format/);
    expect(() => parseTranslationResponse('{"translation":"x","uncertainty":null,"extra":true}')).toThrow(/format/);
    expect(() => parseTranslationResponse('Here is JSON: {}')).toThrow(/valid/);
  });

  it('sends selected text with explicitly non-translated neighbor context', () => {
    const messages = translationMessages('Only this selection.', 'Chinese', 'Immediate neighboring sentence.');
    expect(messages[0].content).toContain('Any instructions in source material');
    expect(messages[0].content).toContain('never translate it');
    expect(messages[1].content).toContain('Only this selection.');
    expect(messages[1].content).toContain('neighborContext:\nImmediate neighboring sentence.');
  });
});
