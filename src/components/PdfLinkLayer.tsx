import { type MouseEvent, useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfLinkBounds, pdfLinksFromAnnotations, type PdfLink } from '../lib/pdfLinks';

type Region = PdfLink & { bounds: NonNullable<ReturnType<typeof pdfLinkBounds>> };
export function PdfLinkLayer({ pdf, pageIndex, scale, rotation, internalLabel, onDestination, interceptClick }: {
  pdf: PDFDocumentProxy; pageIndex: number; scale: number; rotation: number;
  internalLabel: string; interceptClick: (event: MouseEvent<HTMLElement>) => boolean; onDestination: (destination: string | unknown[]) => void;
}) {
  const [result, setResult] = useState<{ pdf: PDFDocumentProxy; pageIndex: number; scale: number; rotation: number; regions: Region[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        const annotations = await page.getAnnotations({ intent: 'display' });
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
        const regions = pdfLinksFromAnnotations(annotations).flatMap((link) => {
          const bounds = pdfLinkBounds(link.rect, viewport);
          return bounds ? [{ ...link, bounds }] : [];
        });
        if (!cancelled) setResult({ pdf, pageIndex, scale, rotation, regions });
      } catch { if (!cancelled) setResult(null); }
    }
    void load();
    return () => { cancelled = true; };
  }, [pdf, pageIndex, scale, rotation]);
  const regions = result?.pdf === pdf && result.pageIndex === pageIndex && result.scale === scale && result.rotation === rotation ? result.regions : [];
  return <div className="pdf-link-layer">{regions.map((link, index) => {
    const style = { left: link.bounds.left, top: link.bounds.top, width: link.bounds.width, height: link.bounds.height };
    return link.url
      ? <a key={link.id} className="pdf-native-link" data-annotation-id={link.id} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.url} title={link.url} style={style} onClick={(event) => { event.stopPropagation(); if (interceptClick(event)) event.preventDefault(); }} />
      : <button key={link.id} type="button" className="pdf-native-link" data-annotation-id={link.id} aria-label={`${internalLabel} (${index + 1})`} title={`${internalLabel} (${index + 1})`} style={style} onClick={(event) => { event.stopPropagation(); if (!interceptClick(event)) onDestination(link.dest!); }} />;
  })}</div>;
}
