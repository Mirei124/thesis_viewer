export type LimitedMathPart =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; source: string; display: boolean };

const MAX_MATH_LENGTH = 2000;

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) backslashes++;
  return backslashes % 2 === 1;
}

/** Recognizes only explicit LaTeX math delimiters; all other input remains text. */
export function limitedMathParts(text: string): LimitedMathPart[] {
  const parts: LimitedMathPart[] = [];
  let plainStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (isEscaped(text, cursor)) { cursor++; continue; }
    let opener = '';
    let closer = '';
    let display = false;
    if (text.startsWith('$$', cursor)) { opener = '$$'; closer = '$$'; display = true; }
    else if (text.startsWith('\\[', cursor)) { opener = '\\['; closer = '\\]'; display = true; }
    else if (text.startsWith('\\(', cursor)) { opener = '\\('; closer = '\\)'; }
    else if (text[cursor] === '$') { opener = '$'; closer = '$'; }
    if (!opener) { cursor++; continue; }

    const contentStart = cursor + opener.length;
    let end = contentStart;
    while (end < text.length && end - contentStart <= MAX_MATH_LENGTH) {
      if (!display && text[end] === '\n') break;
      if (!isEscaped(text, end) && text.startsWith(closer, end)
        && (closer !== '$' || text[end + 1] !== '$')) break;
      end++;
    }
    const value = text.slice(contentStart, end);
    if (end >= text.length || end - contentStart > MAX_MATH_LENGTH || !text.startsWith(closer, end)
      || !value.trim() || (closer === '$' && value.startsWith('$'))) {
      cursor += opener.length;
      continue;
    }
    if (cursor > plainStart) parts.push({ kind: 'text', value: text.slice(plainStart, cursor) });
    parts.push({ kind: 'math', value, source: text.slice(cursor, end + closer.length), display });
    cursor = end + closer.length;
    plainStart = cursor;
  }
  if (plainStart < text.length) parts.push({ kind: 'text', value: text.slice(plainStart) });
  return parts;
}
