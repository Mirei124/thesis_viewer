import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewMarkdown } from './OverviewMarkdown';
import type { VerifiedEvidenceRef } from '../lib/inlineEvidence';

const refs: VerifiedEvidenceRef[] = [
  { alias: 'E001', evidenceIds: ['first', 'second'] },
  { alias: 'E002', evidenceIds: ['third'] },
];
const render = (text: string, evidenceRefs = refs) => renderToStaticMarkup(<OverviewMarkdown text={text} evidenceRefs={evidenceRefs}
  renderSource={source => <button data-alias={source.alias} data-members={source.evidenceIds.join(',')}>{source.alias}</button>} />);

describe('overview Markdown rendering', () => {
  it('renders paragraphs, emphasis, headings and nested step/module lists', () => {
    const html = render('输入产生输出。\n\n### 编码\n\n1. **模块**将 *输入* 编码。[E001]\n   - 内层步骤\n2. 解码输出。\n\n> 原文限定。');
    expect(html).toContain('<p>输入产生输出。</p>');
    expect(html).toContain('<h6 class="insight-markdown-heading">编码</h6>');
    expect(html).toContain('<ol start="1"><li><strong>模块</strong>将 <em>输入</em> 编码。');
    expect(html).toContain('<ul><li>内层步骤</li></ul>');
    expect(html).toContain('<blockquote><p>原文限定。</p>');
    expect(html.match(/data-alias="E001"/g)).toHaveLength(1);
    expect(html.match(/data-alias="E002"/g)).toHaveLength(1);
    expect(html).toContain('data-members="first,second"');
  });

  it('appends unused refs only once for the whole document and leaves unknown aliases literal', () => {
    const html = render('第一段。\n\n第二段 E099。\n\n- 第三段\n- 第四段');
    expect(html.match(/data-alias="E001"/g)).toHaveLength(1);
    expect(html.match(/data-alias="E002"/g)).toHaveLength(1);
    expect(html).toContain('E099');
    expect(html).not.toContain('data-alias="E099"');
  });

  it('never inserts model HTML, unsafe links or images into the DOM', () => {
    const html = render('<script>alert(1)</script>\n\n[x](javascript:alert%281%29) ![alt](https://evil.test/a.png) <img src=x onerror=alert(1)>\n\n[paper](https://example.test/paper)', []);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('alt');
    expect(html).toContain('href="https://example.test/paper"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps code literal and source controls outside links', () => {
    const html = render('`E001 **code**`\n\n```text\nE002 <script>\n```\n\n[E001](https://example.test)');
    expect(html).toContain('<code>E001 **code**</code>');
    expect(html).toContain('<code>E002 &lt;script&gt;</code>');
    expect(html).toContain('rel="noopener noreferrer">E001</a>');
    expect(html.match(/data-alias="E001"/g)).toHaveLength(1);
    expect(html.match(/data-alias="E002"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<a[^>]*><button/);
  });

  it('protects LaTeX underscores, asterisks and backslashes from Markdown parsing', () => {
    const html = render('**变量** $x_i * y_j$ 与 \\(z_k\\)。\n\n\\[\nx_i * y_j\n\\]\n\n$$a_b$$', []);
    expect(html.match(/insight-math-inline/g)).toHaveLength(2);
    expect(html.match(/insight-math-display/g)).toHaveLength(2);
    expect(html).not.toContain('<em>');
    expect(html).toContain('<strong>变量</strong>');
  });

  it('renders extractable Markdown tables without loading resources', () => {
    const html = render('| 模块 | 操作 |\n| --- | --- |\n| A | **编码** E001 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>模块</th>');
    expect(html).toContain('<td><strong>编码</strong> ');
    expect(html.match(/data-alias="E001"/g)).toHaveLength(1);
  });
  it('decodes text entities without turning decoded text into executable HTML', () => {
    const html = render('A &amp; B &#x3b1; &lt;img src=x onerror=alert(1)&gt; [unsafe](javascript&#58;alert%281%29) `&amp;`', []);
    expect(html).toContain('A &amp; B α &lt;img');
    expect(html).not.toContain('&amp;amp; B');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<code>&amp;amp;</code>');
  });

  it('folds same-sentence refs across emphasis while keeping refs available in each paragraph', () => {
    const html = render('E001 **模块 E001** 处理。下一句 E001。\n\nE001 描述另一阶段。');
    expect(html.match(/data-alias="E001"/g)).toHaveLength(3);
    expect(html).toContain('<strong>模块 </strong>');
    expect(html.match(/data-alias="E002"/g)).toHaveLength(1);
  });

  it('degrades excessive nesting to readable text instead of overflowing the render stack', () => {
    const text = '> '.repeat(150) + '**深层** E001';
    const html = render(text);
    expect(html).toContain('&gt; &gt;');
    expect(html).toContain('**深层**');
    expect(html.match(/data-alias="E001"/g)).toHaveLength(1);
    expect(html.match(/data-alias="E002"/g)).toHaveLength(1);
  });

});
