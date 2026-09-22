import { createRoot } from 'react-dom/client';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  GlobalWorkerOptions,
  getDocument,
  InvalidPDFException,
  PasswordException,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import '../styles.css';
import 'pdfjs-dist/web/pdf_viewer.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ReaderState =
  | { kind: 'idle' }
  | { kind: 'loading'; fileName: string }
  | { kind: 'ready'; fileName: string; pageCount: number }
  | { kind: 'error'; message: string };

function readerError(error: unknown): string {
  if (error instanceof PasswordException) {
    return 'This PDF is password protected. Password entry is not part of this rendering spike.';
  }
  if (error instanceof InvalidPDFException) {
    return 'This file appears to be damaged or is not a readable PDF.';
  }
  if (error instanceof Error) {
    return `PDF.js could not load this file: ${error.message}`;
  }
  return 'PDF.js could not load this file.';
}

function isPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function ReaderPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [state, setState] = useState<ReaderState>({ kind: 'idle' });

  useEffect(() => () => {
    void loadingTaskRef.current?.destroy();
    void documentRef.current?.cleanup();
  }, []);

  async function clearPreviousDocument() {
    await Promise.allSettled([
      loadingTaskRef.current?.destroy(),
      documentRef.current?.cleanup(),
    ]);
    loadingTaskRef.current = null;
    documentRef.current = null;
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    textLayerRef.current?.replaceChildren();
  }

  async function renderFirstPage(file: File) {
    await clearPreviousDocument();
    setState({ kind: 'loading', fileName: file.name });

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPdfSignature(bytes)) {
        setState({ kind: 'error', message: 'Choose a PDF file. The selected file does not have a PDF signature.' });
        return;
      }

      const loadingTask = getDocument({ data: bytes });
      loadingTaskRef.current = loadingTask;
      const pdf = await loadingTask.promise;
      documentRef.current = pdf;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !textLayer) throw new Error('The reader surface is no longer available.');

      const outputScale = window.devicePixelRatio || 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser did not provide a canvas rendering context.');

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      textLayer.style.width = `${Math.floor(viewport.width)}px`;
      textLayer.style.height = `${Math.floor(viewport.height)}px`;
      textLayer.replaceChildren();

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      }).promise;
      await new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport }).render();
      setState({ kind: 'ready', fileName: file.name, pageCount: pdf.numPages });
    } catch (error) {
      setState({ kind: 'error', message: readerError(error) });
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void renderFirstPage(file);
    event.target.value = '';
  }

  return (
    <main className="reader-page" aria-labelledby="page-title">
      <header className="reader-header">
        <div>
          <p className="eyebrow">Independent reader · local PDF.js spike</p>
          <h1 id="page-title">Open a local PDF</h1>
        </div>
        <label className="file-picker">
          <span>Choose PDF</span>
          <input aria-label="Choose a local PDF" type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
        </label>
      </header>
      <section className="reader-status" aria-live="polite" role="status">
        {state.kind === 'idle' && 'No document is loaded. Choose a local PDF to render its first page.'}
        {state.kind === 'loading' && `Loading ${state.fileName} with the extension-packaged PDF.js worker…`}
        {state.kind === 'ready' && `${state.fileName}: page 1 of ${state.pageCount}. Text can be selected over the canvas.`}
        {state.kind === 'error' && state.message}
      </section>
      <section className="reader-stage" aria-label="PDF first page preview">
        <div className="pdf-page" hidden={state.kind !== 'ready' && state.kind !== 'loading'}>
          <canvas ref={canvasRef} aria-label="Rendered first PDF page" />
          <div ref={textLayerRef} className="textLayer" aria-label="Selectable text from the first PDF page" />
        </div>
      </section>
      <p className="reader-boundary">This spike renders only the first page of a selected local PDF. It does not save files, support passwords, navigation, zoom, search, outlines, thumbnails, annotations, HTML/URL import, or AI features.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReaderPage />);
