import { Fragment, type ReactNode } from 'react';
import { decodeHTML } from 'entities';
import { Marked, type Token, type Tokens } from 'marked';
import { inlineEvidenceParts, type InlineEvidencePart, type VerifiedEvidenceRef } from '../lib/inlineEvidence';
import { limitedMathParts } from '../lib/limitedMath';
import { LimitedMath } from './LimitedMath';

type SourcePart = Extract<InlineEvidencePart, { kind: 'source' }>;

// Parse Markdown into tokens only. Model HTML is never passed to an HTML sink.
const markdown = new Marked({ gfm: true, breaks: false });
for (const level of ['block', 'inline'] as const) {
  markdown.use({ extensions: [{
    name: 'paper_math', level,
    start: source => source.search(level === 'block' ? /\$\$|\\\[/ : /\$|\\[([]/),
    tokenizer(source) {
      if (!(level === 'block' ? /^(?:\$\$|\\\[)/ : /^(?:\$|\\[([])/).test(source)) return;
      const first = limitedMathParts(source.slice(0, 2010))[0];
      if (first?.kind === 'math' && (level !== 'block' || first.display)) {
        return { type: 'paper_math', raw: first.source, text: first.source };
      }
    },
  }] });
}

/** Only explicit web URLs are navigable; no model image or raw HTML loads resources. */
function webUrl(value: string): string | undefined {
  try {
    const url = new URL(decodeHTML(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch { return undefined; }
}

export function OverviewMarkdown({ text, evidenceRefs, renderSource }: {
  text: string;
  evidenceRefs: readonly VerifiedEvidenceRef[];
  renderSource: (source: SourcePart, key: string) => ReactNode;
}) {
  const mentioned = new Set<string>();
  const sentenceAliases = new Set<string>();
  let nextKey = 0;
  const prose = (value: string, sources: boolean): ReactNode => {
    if (!sources) return value;
    // Match locally without appending here. Unmentioned refs are appended once,
    // after the entire Markdown block rather than after every paragraph/token.
    const present = new Set(value.match(/\b(?:E\d{3}|S\d{2})\b/g) ?? []);
    return inlineEvidenceParts(value, evidenceRefs.filter(ref => present.has(ref.alias))).map(part => {
      const key = `inline-${nextKey++}`;
      if (part.kind === 'text') {
        if (/[。！？.!?\n]/.test(part.value)) sentenceAliases.clear();
        return <Fragment key={key}>{part.value}</Fragment>;
      }
      if (sentenceAliases.has(part.alias)) return null;
      sentenceAliases.add(part.alias);
      mentioned.add(part.alias);
      return <Fragment key={key}>{renderSource(part, key)}</Fragment>;
    });
  };
  const render = (tokens: readonly Token[], sources = true, tight = false, depth = 0): ReactNode => {
    if (depth > 64) throw new Error('Markdown nesting exceeds the display limit.');
    return tokens.map(token => {
      const key = `markdown-${nextKey++}`;
      const children = () => render((token as Tokens.Generic).tokens ?? [], sources, false, depth + 1);
      let node: ReactNode;
      switch (token.type) {
        case 'space': case 'def': return null;
        case 'paper_math': node = <LimitedMath text={token.text} />; break;
        case 'paragraph': sentenceAliases.clear(); node = tight ? children() : <p>{children()}</p>; break;
        case 'heading': node = <h6 className="insight-markdown-heading">{children()}</h6>; break;
        case 'strong': node = <strong>{children()}</strong>; break;
        case 'em': node = <em>{children()}</em>; break;
        case 'del': node = <del>{children()}</del>; break;
        case 'br': node = <br />; break;
        case 'hr': node = <hr />; break;
        case 'blockquote': node = <blockquote>{children()}</blockquote>; break;
        case 'code': node = <pre tabIndex={0}><code>{token.text}</code></pre>; break;
        case 'codespan': node = <code>{token.text}</code>; break;
        case 'html': node = token.raw; break;
        case 'escape': node = token.text; break;
        case 'text': node = token.tokens ? children() : prose(decodeHTML(token.text), sources); break;
        case 'link': {
          const href = webUrl(token.href);
          // Source controls stay outside anchors: a button must not be nested in a link.
          node = href ? <a href={href} title={token.title ? decodeHTML(token.title) : undefined} target="_blank" rel="noopener noreferrer">{render(token.tokens ?? [], false, false, depth + 1)}</a> : render((token as Tokens.Generic).tokens ?? [], sources, false, depth + 1);
          break;
        }
        case 'image': node = prose(decodeHTML(token.text), sources); break;
        case 'checkbox': node = <input type="checkbox" checked={token.checked} disabled readOnly />; break;
        case 'list': {
          const list = token as Tokens.List;
          const items = list.items.map((item, i) => {
            sentenceAliases.clear();
            return <li key={`${key}-${i}`}>{render(item.tokens, sources, !item.loose, depth + 1)}</li>;
          });
          node = list.ordered ? <ol start={Number(list.start) || 1}>{items}</ol> : <ul>{items}</ul>;
          break;
        }
        case 'table': {
          const table = token as Tokens.Table;
          node = <div className="insight-markdown-table" tabIndex={0} role="region" aria-label="Table">
            <table><thead><tr>{table.header.map((cell, i) => <th key={i} style={{ textAlign: cell.align ?? undefined }}>{render(cell.tokens, sources, false, depth + 1)}</th>)}</tr></thead>
              <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ textAlign: cell.align ?? undefined }}>{render(cell.tokens, sources, false, depth + 1)}</td>)}</tr>)}</tbody></table>
          </div>;
          break;
        }
        default: node = token.raw;
      }
      return <Fragment key={key}>{node}</Fragment>;
    });
  };
  let content: ReactNode;
  try { content = render(markdown.lexer(text)); }
  catch {
    // A malformed/deeply nested Markdown input must remain readable as text.
    mentioned.clear();
    sentenceAliases.clear();
    content = <p>{prose(text, true)}</p>;
  }
  const remaining = inlineEvidenceParts('', evidenceRefs.filter(ref => !mentioned.has(ref.alias)));
  return <div className="insight-markdown">{content}{remaining.length > 0 && <span className="insight-markdown-sources">{remaining.map((part, i) => part.kind === 'text' ? part.value : renderSource(part, `remaining-${i}`))}</span>}</div>;
}
