/** Display-only hints from local text; never changes citation matching or anchors. */
export type ReferencePresentation = { title: string; authors: string; year: string; venue?: string };

function authorList(text: string): boolean {
  if (text.length > 1400 || /[\d:?!"“”]/u.test(text)) return false;
  const names = text.replace(/,?\s*(?:and\s+)?et al\.?$/u, '').split(/,\s*|\s+and\s+/u);
  return names.length > 0 && names.every((name) => {
    const words = name.trim().replace(/^and\s+/u, '').split(/\s+/u);
    return words.length >= 1 && words.length <= 8 && words.every((word) =>
      /^(?:\p{Lu}[\p{L}\p{M}'’`.´-]*\.?|[A-Z]\.|de|van|von|da|del|la|y)$/u.test(word));
  });
}

function titleText(text: string): boolean {
  return text.length >= 8 && text.length <= 450 && /\p{L}/u.test(text)
    && text.split(/\s+/u).length >= 2
    && !/https?:\/\/|\[\s*\d+\s*\]|supplementary material|\bappendix\b|\breferences\b/iu.test(text)
    && !/\.\s+\p{L}/u.test(text);
}

function venueText(text: string): boolean {
  if (text.length > 180 || !/\p{L}/u.test(text) || /[?!]|https?:\/\/|\[|\]/iu.test(text)) return false;
  if (/^(?:In\s+|arxiv\s+preprint|Proceedings\s+|Journal\s+|Transactions\s+)/iu.test(text)) return true;
  // Title-cased venue names are supported; arbitrary sentences are not venues.
  return text.split(/\s+/u).every((word) =>
    /^(?:\p{Lu}[\p{L}\p{M}0-9&'’.-]*|of|the|and|on|for|in|&|\d+[,:()-]*)$/u.test(word));
}

/**
 * Recognizes narrowly supported author/title/year formats. Entire entry must
 * fit, so merged columns, appendix prose and incomplete entries stay visible
 * as raw text. Initials and decimal periods are not author/title boundaries.
 */
export function referencePresentation(rawText: string): ReferencePresentation | null {
  const text = rawText.replace(/^\s*\[\s*\d+\s*\]\s*/u, '').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 2200) return null;
  // Only numeric backreferences and an explicitly written URL/DOI may follow
  // the bibliographic year. Arbitrary prose means the entry is contaminated.
  const end = text.match(/(?:,\s*|\.\s+|\s+\()(?:((?:18|19|20)\d{2})[a-z]?)(?:\))?\.?\s*((?:\d+(?:\s*[,–-]\s*\d+)*\.?\s*)?(?:(?:doi:\s*10\.\S+|https?:\/\/\S+)\.?\s*)?)$/iu);
  if (!end || end.index === undefined) return null;
  const body = text.slice(0, end.index).trim();
  const year = end[1];
  const boundaries = [...body.matchAll(/\.\s+/gu)].map((match) => match.index!);
  for (const boundary of boundaries) {
    const authors = body.slice(0, boundary).trim();
    if (!authorList(authors)) continue;
    const rest = body.slice(boundary + 1).trim();
    // A boundary following a single initial is not the end of the author list.
    if (/(?:^|\s)[A-Z]$/u.test(authors) || authors.endsWith('et')) continue;
    let title = rest;
    let venue: string | undefined;
    const quoted = rest.match(/^[“"]([^“”"]+)[”"]\.?\s*(.*)$/u);
    if (quoted) {
      title = quoted[1].replace(/\.$/u, '').trim();
      const tail = quoted[2].replace(/\.$/u, '').trim();
      if (tail) {
        if (!venueText(tail)) return null;
        venue = tail;
      }
    } else {
      if (/[“”"]/u.test(rest)) return null;
      // Last sentence boundary splits a title (which may contain decimals)
      // from a bibliographic venue; absent a venue the title precedes the year.
      const separator = [...rest.matchAll(/[.!?]\s+/gu)].at(-1);
      const split = separator?.index;
      if (split !== undefined) {
        const tail = rest.slice(split + 1).trim();
        if (!venueText(tail)) return null;
        title = rest.slice(0, split + (separator?.[0][0] === '.' ? 0 : 1)).trim();
        venue = tail;
      }
      title = title.replace(/\.$/u, '').trim();
    }
    // URLs are actions, not a venue. Avoid inventing other missing fields.
    if (!titleText(title) || /\.\s+(?:\p{Lu}[\p{L}-]*,|In\s)/u.test(title)) return null;
    return { title, authors: `${authors}.`, year, ...(venue ? { venue } : {}) };
  }
  return null;
}
