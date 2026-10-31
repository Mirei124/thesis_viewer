import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPdfBibliography, metadataAuthors, pageBibliography } from './pdfBibliography';
const item = (str: string, y: number, size = 12, x = 40, width = 100) => ({ str, transform: [size, 0, 0, size, x, y], width });
const title = item('A Useful Paper About Visual Intelligence', 750, 20);
const page = [title, item('Alice Smith, Bob Jones', 710), item('1 University of Somewhere', 688), item('Abstract', 650), item('Our institute proposes a method.', 630)];
function pdf(info: unknown, creators: unknown, items = page): PDFDocumentProxy {
  return { getMetadata: async () => ({ info, metadata: { get: () => creators } }), getPage: async () => ({ view: [0, 0, 600, 800], getTextContent: async () => ({ items }) }) } as unknown as PDFDocumentProxy;
}
describe('PDF bibliography extraction', () => {
  it('prefers structured XMP creators, retains page institutions', async () => {
    expect(await extractPdfBibliography(pdf({ Author: 'Wrong Name' }, ['Alice Smith', 'Bob Jones']))).toEqual({ authors: ['Alice Smith', 'Bob Jones'], authorsSource: 'metadata', institutions: ['University of Somewhere'], institutionsSource: 'page' });
  });
  it('reads Info.Author when XMP is missing and ignores malformed entries/placeholders', async () => {
    expect((await extractPdfBibliography(pdf({ Author: 'Alice Smith; Bob Jones' }, undefined))).authors).toEqual(['Alice Smith', 'Bob Jones']);
    expect(metadataAuthors(['Anonymous Authors', null, 'unknown', 'Overleaf', 'Alice Smith'])).toEqual(['Alice Smith']);
    expect(metadataAuthors({ names: 'Alice Smith' })).toEqual([]);
    expect(metadataAuthors('Doe, Jane; Smith, John')).toEqual(['Doe, Jane', 'Smith, John']);
  });
  it('falls back to the author block and stops before abstract', () => {
    expect(pageBibliography(page, 800)).toEqual({ authors: ['Alice Smith', 'Bob Jones'], authorsSource: 'page', institutions: ['University of Somewhere'], institutionsSource: 'page' });
  });
  it('groups split name tokens and separates large column gaps', () => {
    const data = pageBibliography([title, item('Alice', 710, 12, 40, 26), item('Smith', 710, 12, 70, 28), item('Bob Jones', 710, 12, 190), item('Google Research', 690), item('Abstract', 650)], 800);
    expect(data.authors).toEqual(['Alice Smith', 'Bob Jones']);
    expect(data.institutions).toEqual(['Google Research']);
  });
  it('splits compact author gaps, joins overlapping accent fragments and rejects contribution roles', () => {
    const data = pageBibliography([title,
      item('Eric Mintun', 710, 10, 40, 48), item('Nikhila Ravi', 710, 10, 105, 51),
      item('Piotr Doll´', 695, 10, 40, 44), item('ar', 695, 10, 80, 8), item('Ross Girshick', 695, 10, 106, 56),
      item('project lead', 680, 9), item('Meta AI Research, FAIR', 665), item('Abstract', 650)], 800);
    expect(data.authors).toEqual(['Eric Mintun', 'Nikhila Ravi', 'Piotr Dollár', 'Ross Girshick']);
  });
  it('keeps multiple affiliation lines and Chinese names without inventing mappings', () => {
    const data = pageBibliography([title, item('张三、李四', 710), item('清华大学', 690), item('Institute of Computing, Example Academy', 675), item('Abstract', 650)], 800);
    expect(data.authors).toEqual(['张三', '李四']);
    expect(data.institutions).toEqual(['清华大学', 'Institute of Computing, Example Academy']);
  });
  it('reads interleaved author-affiliation rows and deduplicates institution columns', () => {
    const data = pageBibliography([title, item('Alice Smith∗', 710), item('Google Brain', 695, 12, 40, 80), item('Google Research', 695, 12, 150, 90), item('Bob Jones', 680), item('Google Brain', 665), item('Abstract', 650)], 800);
    expect(data.authors).toEqual(['Alice Smith', 'Bob Jones']);
    expect(data.institutions).toEqual(['Google Brain', 'Google Research']);
  });
  it('does not treat anonymous notices, emails, abstract prose or body citations as affiliations', () => {
    expect(pageBibliography([title, item('Anonymous Authors', 710), item('alice@university.edu', 690), item('Abstract', 675), item('University of Elsewhere improves results.', 660)], 800)).toEqual({});
    expect(pageBibliography([item('Ordinary body prose with no prominent title', 740), item('University of Somewhere', 710)], 800)).toEqual({});
  });
  it('excludes a rotated arXiv sidebar and tiny affiliation markers', () => {
    expect(pageBibliography([...page, { str: 'arXiv: 2610.00001', transform: [0, 12, -12, 0, 10, 730] }, item('1', 715, 7, 155)], 800).authors).toEqual(['Alice Smith', 'Bob Jones']);
  });
  it('extracts all twelve SAM authors from the actual PDF text geometry', () => {
    const items = [{"str":"Segment Anything","transform":[17.2154,0,0,17.2154,229.465,679.586],"width":136.29432179999998},{"str":"Alexander Kirillov","transform":[9.9626,0,0,9.9626,71.97999999999999,658.736],"width":75.2375552},{"str":"1","transform":[6.9738,0,0,6.9738,147.21699999999998,662.351],"width":3.9715790999999996},{"str":",","transform":[6.9738,0,0,6.9738,151.188,662.351],"width":2.36621034},{"str":"2","transform":[6.9738,0,0,6.9738,153.554,662.351],"width":3.9715790999999996},{"str":",","transform":[6.9738,0,0,6.9738,157.525,662.351],"width":2.36621034},{"str":"4","transform":[6.9738,0,0,6.9738,159.892,662.351],"width":3.9715790999999996},{"str":"Eric Mintun","transform":[9.9626,0,0,9.9626,176.814,658.736],"width":48.42819859999999},{"str":"2","transform":[6.9738,0,0,6.9738,225.242,662.351],"width":3.9715790999999996},{"str":"Nikhila Ravi","transform":[9.9626,0,0,9.9626,242.165,658.736],"width":50.998549400000016},{"str":"1","transform":[6.9738,0,0,6.9738,293.163,662.351],"width":3.9715790999999996},{"str":",","transform":[6.9738,0,0,6.9738,297.134,662.351],"width":2.36621034},{"str":"2","transform":[6.9738,0,0,6.9738,299.5,662.351],"width":3.9715790999999996},{"str":"Hanzi Mao","transform":[9.9626,0,0,9.9626,316.423,658.736],"width":44.54278460000002},{"str":"2","transform":[6.9738,0,0,6.9738,360.966,662.351],"width":3.9715790999999996},{"str":"Chloe Rolland","transform":[9.9626,0,0,9.9626,377.88800000000003,658.736],"width":57.84285560000001},{"str":"3","transform":[6.9738,0,0,6.9738,435.73100000000005,662.351],"width":3.9715790999999996},{"str":"Laura Gustafson","transform":[9.9626,0,0,9.9626,452.6530000000001,658.736],"width":66.12177620000001},{"str":"3","transform":[6.9738,0,0,6.9738,518.7750000000001,662.351],"width":3.9715790999999996},{"str":"Tete Xiao","transform":[9.9626,0,0,9.9626,72.88100000000009,644.788],"width":38.864102599999995},{"str":"3","transform":[6.9738,0,0,6.9738,111.74500000000009,648.404],"width":3.9715790999999996},{"str":"Spencer Whitehead","transform":[9.9626,0,0,9.9626,134.3770000000001,644.788],"width":77.7381678},{"str":"Alexander C. Berg","transform":[9.9626,0,0,9.9626,230.27698760000015,644.788],"width":74.64976180000004},{"str":"Wan-Yen Lo","transform":[9.9626,0,0,9.9626,323.08856920000017,644.788],"width":50.490456800000004},{"str":"Piotr Doll´","transform":[9.9626,0,0,9.9626,391.74084580000005,644.788],"width":43.451700000000244},{"str":"ar","transform":[9.9626,0,0,9.9626,431.3220000000001,644.788],"width":7.740940200000001},{"str":"4","transform":[6.9738,0,0,6.9738,439.0630000000001,648.404],"width":3.9715790999999996},{"str":"Ross Girshick","transform":[9.9626,0,0,9.9626,461.6950000000001,644.788],"width":56.179101400000015},{"str":"4","transform":[6.9738,0,0,6.9738,517.8740000000001,648.404],"width":3.9715790999999996},{"str":"1","transform":[5.9776,0,0,5.9776,148.69200000000012,634.65],"width":3.65291136},{"str":"project lead","transform":[8.9664,0,0,8.9664,152.84300000000013,630.841],"width":42.07931520000002},{"str":"2","transform":[5.9776,0,0,5.9776,215.09600000000012,634.65],"width":3.65291136},{"str":"joint first author","transform":[8.9664,0,0,8.9664,219.24700000000013,630.841],"width":57.78844800000003},{"str":"3","transform":[5.9776,0,0,5.9776,297.2090000000001,634.65],"width":3.65291136},{"str":"equal contribution","transform":[8.9664,0,0,8.9664,301.3600000000001,630.841],"width":65.32022400000002},{"str":"4","transform":[5.9776,0,0,5.9776,386.8530000000001,634.65],"width":3.65291136},{"str":"directional lead","transform":[8.9664,0,0,8.9664,391.00400000000013,630.841],"width":55.528915200000014},{"str":"Meta AI Research, FAIR","transform":[11.9552,0,0,11.9552,237.96200000000013,614.058],"width":119.30094080000006}];
    const data = pageBibliography(items, 792);
    expect(data.authors).toEqual(['Alexander Kirillov', 'Eric Mintun', 'Nikhila Ravi', 'Hanzi Mao', 'Chloe Rolland', 'Laura Gustafson', 'Tete Xiao', 'Spencer Whitehead', 'Alexander C. Berg', 'Wan-Yen Lo', 'Piotr Dollár', 'Ross Girshick']);
    expect(data.institutions).toEqual(['Meta AI Research, FAIR']);
  });
  it('does not block history when metadata or first-page extraction fails', async () => {
    const broken = { getMetadata: async () => { throw Error('bad'); }, getPage: async () => { throw Error('bad'); } } as unknown as PDFDocumentProxy;
    expect(await extractPdfBibliography(broken)).toEqual({});
  });
});
