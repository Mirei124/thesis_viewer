import { createRoot } from 'react-dom/client';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
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
  | { kind: 'requesting-permission'; fileName: string }
  | { kind: 'loading'; fileName: string }
  | { kind: 'ready'; fileName: string; pageCount: number; pageIndex: number; scale: number; rotation: number }
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string };

type OptionalPermissionsApi = {
  request: (permissions: { origins: string[] }) => Promise<boolean>;
};

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

function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<head') || prefix.startsWith('<body');
}

function permissionPattern(url: URL): string {
  // WebExtension host permissions are scoped to a scheme and host. Ports are
  // not expressible in a match pattern, so the browser applies this to HTTPS on
  // the submitted host; the request itself still uses the exact submitted URL.
  return `${url.protocol}//${url.hostname}/*`;
}

function getOptionalPermissionsApi(): OptionalPermissionsApi | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { permissions?: OptionalPermissionsApi };
    chrome?: { permissions?: OptionalPermissionsApi };
  };
  return extensionGlobal.browser?.permissions ?? extensionGlobal.chrome?.permissions;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const THUMBNAIL_MAX_WIDTH = 144;
const THUMBNAIL_MAX_HEIGHT = 200;
const THUMBNAIL_SCALE = 0.24;

type ViewState = Pick<Extract<ReaderState, { kind: 'ready' }>, 'pageIndex' | 'scale' | 'rotation'>;
type PdfOutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];
type OutlineState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: PdfOutlineItem[] }
  | { kind: 'unavailable'; message: string };
type Thumbnail = { kind: 'loading' } | { kind: 'ready'; src: string } | { kind: 'error' };

function OutlineItems({ items, depth, onNavigate }: {
  items: PdfOutlineItem[];
  depth: number;
  onNavigate: (item: PdfOutlineItem) => void;
}) {
  return (
    <ul className="outline-list">
      {items.map((item, index) => (
        <li key={`${depth}-${index}-${item.title}`}>
          <button
            type="button"
            className="outline-item"
            style={{ paddingInlineStart: `${0.5 + depth}rem` }}
            onClick={() => onNavigate(item)}
            disabled={!item.dest}
            title={item.dest ? `Go to ${item.title}` : 'This outline entry has no PDF destination.'}
          >
            {item.title || 'Untitled outline entry'}
          </button>
          {item.items.length > 0 && <OutlineItems items={item.items} depth={depth + 1} onNavigate={onNavigate} />}
        </li>
      ))}
    </ul>
  );
}

function ReaderPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const renderIdRef = useRef(0);
  const thumbnailRequestIdRef = useRef(0);
  const [state, setState] = useState<ReaderState>({ kind: 'idle' });
  const [urlValue, setUrlValue] = useState('');
  const [pageInput, setPageInput] = useState('1');
  const [isRendering, setIsRendering] = useState(false);
  const [outline, setOutline] = useState<OutlineState>({ kind: 'idle' });
  const [outlineNotice, setOutlineNotice] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<number, Thumbnail>>({});
  const [thumbnailSession, setThumbnailSession] = useState(0);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    renderTaskRef.current?.cancel();
    textLayerTaskRef.current?.cancel();
    thumbnailRequestIdRef.current += 1;
    void loadingTaskRef.current?.destroy();
    void documentRef.current?.cleanup();
  }, []);

  async function clearPreviousDocument() {
    renderIdRef.current += 1;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
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

  function isCurrent(requestId: number) {
    return requestId === requestIdRef.current;
  }

  function beginImport() {
    requestIdRef.current += 1;
    renderIdRef.current += 1;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    thumbnailRequestIdRef.current += 1;
    setThumbnails({});
    setOutline({ kind: 'idle' });
    setOutlineNotice('');
    const requestId = requestIdRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    return requestId;
  }

  async function prepareImport(fileName: string, requestId: number, controller: AbortController | null = null) {
    if (!isCurrent(requestId)) return false;
    abortControllerRef.current = controller;
    await clearPreviousDocument();
    if (!isCurrent(requestId)) return false;
    setState({ kind: 'loading', fileName });
    return true;
  }

  function isCurrentRender(requestId: number, renderId: number) {
    return isCurrent(requestId) && renderId === renderIdRef.current;
  }

  async function loadOutline(pdf: PDFDocumentProxy, requestId: number) {
    setOutline({ kind: 'loading' });
    try {
      const items = await pdf.getOutline();
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      setOutline(items && items.length > 0
        ? { kind: 'ready', items }
        : { kind: 'unavailable', message: 'This PDF does not provide an outline.' });
    } catch {
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      setOutline({ kind: 'unavailable', message: 'The PDF outline could not be read.' });
    }
  }

  async function navigateOutline(item: PdfOutlineItem) {
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    if (!pdf || !item.dest || state.kind !== 'ready') return;
    setOutlineNotice('Resolving outline destination…');
    try {
      const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (!destination?.[0] || typeof destination[0] !== 'object') {
        setOutlineNotice(`“${item.title || 'This outline entry'}” has no page destination that this PDF can resolve.`);
        return;
      }
      const pageIndex = await pdf.getPageIndex(destination[0]);
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) {
        setOutlineNotice(`“${item.title || 'This outline entry'}” resolved to an invalid PDF page.`);
        return;
      }
      setOutlineNotice('');
      goToPage(pageIndex);
    } catch {
      if (isCurrent(requestId) && documentRef.current === pdf) {
        setOutlineNotice(`Could not resolve the destination for “${item.title || 'this outline entry'}”.`);
      }
    }
  }

  useEffect(() => {
    if (state.kind !== 'ready' || !documentRef.current) return;
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    const thumbnailRequestId = ++thumbnailRequestIdRef.current;
    const indices = [state.pageIndex - 1, state.pageIndex, state.pageIndex + 1]
      .filter((pageIndex) => pageIndex >= 0 && pageIndex < state.pageCount);
    let cancelled = false;
    const renderTasks = new Set<{ cancel: () => void }>();

    setThumbnails((previous) => Object.fromEntries(indices.map((pageIndex) => [
      pageIndex,
      previous[pageIndex] ?? { kind: 'loading' },
    ])));

    async function renderThumbnail(pageIndex: number) {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const fullSize = page.getViewport({ scale: 1 });
        const scale = Math.min(THUMBNAIL_SCALE, THUMBNAIL_MAX_WIDTH / fullSize.width, THUMBNAIL_MAX_HEIGHT / fullSize.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTasks.add(renderTask);
        await renderTask.promise;
        renderTasks.delete(renderTask);
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const src = canvas.toDataURL('image/png');
        setThumbnails((previous) => ({ ...previous, [pageIndex]: { kind: 'ready', src } }));
      } catch {
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        setThumbnails((previous) => ({ ...previous, [pageIndex]: { kind: 'error' } }));
      }
    }

    for (const pageIndex of indices) {
      if (!thumbnails[pageIndex] || thumbnails[pageIndex].kind === 'loading') void renderThumbnail(pageIndex);
    }
    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  // `thumbnailSession` changes after each successfully loaded document, even when its filename and first page match the prior document.
  }, [state.kind, state.kind === 'ready' ? state.pageIndex : -1, thumbnailSession]);

  async function renderPage(pdf: PDFDocumentProxy, view: ViewState, requestId: number): Promise<boolean> {
    const renderId = ++renderIdRef.current;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    if (isCurrent(requestId)) setIsRendering(true);

    try {
      const page = await pdf.getPage(view.pageIndex + 1);
      if (!isCurrentRender(requestId, renderId)) return false;
      const viewport = page.getViewport({ scale: view.scale, rotation: view.rotation });
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
      // PDF.js's viewer stylesheet uses these variables to calculate the
      // visible text layer dimensions from its unrotated page coordinates.
      // They must live on the real container (rather than a staging element)
      // so its data-main-rotation transform applies with the canvas viewport.
      textLayer.style.setProperty('--total-scale-factor', String(view.scale));
      textLayer.style.setProperty('--scale-round-x', '1px');
      textLayer.style.setProperty('--scale-round-y', '1px');
      textLayer.replaceChildren();

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      if (!isCurrentRender(requestId, renderId)) return false;
      const textLayerTask = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
      textLayerTaskRef.current = textLayerTask;
      await textLayerTask.render();
      if (!isCurrentRender(requestId, renderId)) return false;
      return true;
    } catch (error) {
      if (!isCurrentRender(requestId, renderId)) return false;
      setState({ kind: 'error', message: readerError(error) });
      return false;
    } finally {
      if (isCurrentRender(requestId, renderId)) {
        renderTaskRef.current = null;
        textLayerTaskRef.current = null;
        setIsRendering(false);
      }
    }
  }

  async function loadPdf(bytes: Uint8Array, fileName: string, requestId: number) {
    if (!isCurrent(requestId)) return;
    try {
      if (!isPdfSignature(bytes)) {
        setState({ kind: 'error', message: 'Choose a PDF file. The selected file does not have a PDF signature.' });
        return;
      }

      const loadingTask = getDocument({ data: bytes });
      loadingTaskRef.current = loadingTask;
      const pdf = await loadingTask.promise;
      if (!isCurrent(requestId)) {
        await loadingTask.destroy();
        return;
      }
      documentRef.current = pdf;
      const initialView: ViewState = { pageIndex: 0, scale: 1.35, rotation: 0 };
      void loadOutline(pdf, requestId);
      if (!await renderPage(pdf, initialView, requestId)) return;
      if (!isCurrent(requestId)) return;
      setPageInput('1');
      setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...initialView });
      setThumbnailSession(requestId);
    } catch (error) {
      if (!isCurrent(requestId)) return;
      setState({ kind: 'error', message: readerError(error) });
    }
  }

  async function importLocalFile(file: File) {
    const requestId = beginImport();
    if (!await prepareImport(file.name, requestId)) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent(requestId)) return;
      await loadPdf(bytes, file.name, requestId);
    } catch (error) {
      if (isCurrent(requestId)) setState({ kind: 'error', message: readerError(error) });
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void importLocalFile(file);
    event.target.value = '';
  }

  async function importUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      setState({ kind: 'error', message: 'Enter a complete HTTPS PDF URL.' });
      return;
    }
    if (url.protocol !== 'https:') {
      setState({ kind: 'error', message: 'Only HTTPS PDF URLs can be imported.' });
      return;
    }

    const permissions = getOptionalPermissionsApi();
    if (!permissions) {
      setState({ kind: 'error', message: 'This browser does not expose the extension permission API.' });
      return;
    }
    const requestId = beginImport();
    const origin = permissionPattern(url);
    // This call must remain synchronous with the form-submit user gesture. In
    // particular, do not await document cleanup or permissions.contains() first.
    let permissionRequest: Promise<boolean>;
    try {
      permissionRequest = permissions.request({ origins: [origin] });
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setState({ kind: 'error', message: `Could not request permission for ${url.origin}.${detail}` });
      return;
    }
    setState({ kind: 'requesting-permission', fileName: url.href });
    try {
      const granted = await permissionRequest;
      if (!isCurrent(requestId)) return;
      if (!granted) {
        setState({ kind: 'error', message: `Permission to download from ${url.origin} was denied. You can choose a local PDF instead.` });
        return;
      }

      const controller = new AbortController();
      if (!await prepareImport(url.href, requestId, controller)) return;

      const response = await fetch(url.href, {
        credentials: 'omit',
        headers: { Accept: 'application/pdf' },
        signal: controller.signal,
      });
      if (!isCurrent(requestId)) return;
      if (!response.ok) {
        setState({ kind: 'error', message: `The server responded with HTTP ${response.status} ${response.statusText}. Download the PDF and choose it locally instead.` });
        return;
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isCurrent(requestId)) return;
      if (!isPdfSignature(bytes)) {
        const html = contentType.includes('text/html') || looksLikeHtml(bytes);
        setState({
          kind: 'error',
          message: html
            ? 'The URL returned HTML instead of a PDF, often a sign-in or landing page. Download the PDF and choose it locally instead.'
            : 'The downloaded response is not a PDF. Download the PDF and choose it locally instead.',
        });
        return;
      }
      await loadPdf(bytes, url.pathname.split('/').pop() || url.hostname, requestId);
    } catch (error) {
      if (!isCurrent(requestId)) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState({ kind: 'cancelled', message: 'URL import cancelled.' });
        return;
      }
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setState({ kind: 'error', message: `Could not download this PDF. Check the URL and network connection, or choose a local PDF instead.${detail}` });
    }
  }

  function cancelImport() {
    if (state.kind !== 'loading' && state.kind !== 'requesting-permission') return;
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (state.kind === 'loading') void clearPreviousDocument();
    setState({ kind: 'cancelled', message: 'URL import cancelled.' });
  }

  function changeView(nextView: ViewState) {
    if (state.kind !== 'ready' || !documentRef.current) return;
    setState({ ...state, ...nextView });
    setPageInput(String(nextView.pageIndex + 1));
    void renderPage(documentRef.current, nextView, requestIdRef.current);
  }

  function goToPage(pageIndex: number) {
    if (state.kind !== 'ready' || pageIndex < 0 || pageIndex >= state.pageCount) return;
    changeView({ pageIndex, scale: state.scale, rotation: state.rotation });
  }

  function submitPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== 'ready') return;
    const pageNumber = Number(pageInput);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.pageCount) {
      setPageInput(String(state.pageIndex + 1));
      return;
    }
    goToPage(pageNumber - 1);
  }

  function adjustScale(direction: -1 | 1) {
    if (state.kind !== 'ready') return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((state.scale + direction * SCALE_STEP) * 100) / 100));
    if (scale !== state.scale) changeView({ pageIndex: state.pageIndex, scale, rotation: state.rotation });
  }

  function rotate(direction: -1 | 1) {
    if (state.kind !== 'ready') return;
    const rotation = (state.rotation + direction * 90 + 360) % 360;
    changeView({ pageIndex: state.pageIndex, scale: state.scale, rotation });
  }

  return (
    <main className="reader-page" aria-labelledby="page-title">
      <header className="reader-header">
        <div>
          <p className="eyebrow">Independent reader · local PDF.js spike</p>
          <h1 id="page-title">Open a PDF</h1>
        </div>
        <label className="file-picker">
          <span>Choose PDF</span>
          <input aria-label="Choose a local PDF" type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
        </label>
      </header>
      <form className="url-import" onSubmit={importUrl}>
        <label htmlFor="pdf-url">Import an HTTPS PDF URL</label>
        <div className="url-import-controls">
          <input id="pdf-url" type="url" value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.org/paper.pdf" inputMode="url" />
          <button type="submit" disabled={state.kind === 'loading' || state.kind === 'requesting-permission'}>Import URL</button>
          {(state.kind === 'loading' || state.kind === 'requesting-permission') && <button type="button" className="secondary-button" onClick={cancelImport}>Cancel</button>}
        </div>
        <p>Submitting requests permission only for this HTTPS host, then downloads without site cookies and verifies the PDF signature.</p>
      </form>
      <section className="reader-status" aria-live="polite" role="status">
        {state.kind === 'idle' && 'No document is loaded. Choose a local PDF to render its first page.'}
        {state.kind === 'requesting-permission' && `Requesting permission to download from ${state.fileName}…`}
        {state.kind === 'loading' && `Loading ${state.fileName} with the extension-packaged PDF.js worker…`}
        {state.kind === 'ready' && `${state.fileName}: page ${state.pageIndex + 1} of ${state.pageCount} at ${Math.round(state.scale * 100)}% zoom, rotated ${state.rotation}°. Text can be selected over the canvas.`}
        {state.kind === 'cancelled' && state.message}
        {state.kind === 'error' && state.message}
      </section>
      {state.kind === 'ready' && <section className="reader-controls" aria-label="PDF page controls">
        <div className="page-navigation" role="group" aria-label="Page navigation">
          <button type="button" onClick={() => goToPage(state.pageIndex - 1)} disabled={isRendering || state.pageIndex === 0}>Previous page</button>
          <form onSubmit={submitPage}>
            <label htmlFor="page-number">Page</label>
            <input id="page-number" type="text" inputMode="numeric" pattern="[0-9]*" value={pageInput} onChange={(event) => setPageInput(event.target.value)} aria-describedby="page-count" disabled={isRendering} />
            <span id="page-count">of {state.pageCount}</span>
            <button type="submit" disabled={isRendering}>Go</button>
          </form>
          <button type="button" onClick={() => goToPage(state.pageIndex + 1)} disabled={isRendering || state.pageIndex === state.pageCount - 1}>Next page</button>
        </div>
        <div className="view-controls" role="group" aria-label="Zoom and rotation">
          <button type="button" onClick={() => adjustScale(-1)} disabled={isRendering || state.scale <= MIN_SCALE}>Zoom out</button>
          <output aria-label="Current zoom">{Math.round(state.scale * 100)}%</output>
          <button type="button" onClick={() => adjustScale(1)} disabled={isRendering || state.scale >= MAX_SCALE}>Zoom in</button>
          <button type="button" onClick={() => rotate(-1)} disabled={isRendering}>Rotate counterclockwise</button>
          <button type="button" onClick={() => rotate(1)} disabled={isRendering}>Rotate clockwise</button>
        </div>
      </section>}
      <div className="reader-workspace">
        {state.kind === 'ready' && <aside className="reader-navigation" aria-label="PDF navigation">
          <section className="navigation-panel" aria-labelledby="outline-title">
            <h2 id="outline-title">Outline</h2>
            {outline.kind === 'idle' || outline.kind === 'loading'
              ? <p>Reading this PDF’s outline…</p>
              : outline.kind === 'unavailable'
                ? <p>{outline.message}</p>
                : <nav aria-label="PDF outline"><OutlineItems items={outline.items} depth={0} onNavigate={navigateOutline} /></nav>}
            {outlineNotice && <p className="navigation-notice" role="status">{outlineNotice}</p>}
          </section>
          <section className="navigation-panel" aria-labelledby="thumbnails-title">
            <h2 id="thumbnails-title">Pages</h2>
            <p className="thumbnail-hint">Previews are rendered only for this page and its immediate neighbors.</p>
            <div className="thumbnail-list" aria-label="Nearby page thumbnails">
              {[state.pageIndex - 1, state.pageIndex, state.pageIndex + 1]
                .filter((pageIndex) => pageIndex >= 0 && pageIndex < state.pageCount)
                .map((pageIndex) => {
                  const thumbnail = thumbnails[pageIndex];
                  return <button
                    type="button"
                    className="thumbnail-button"
                    key={pageIndex}
                    onClick={() => goToPage(pageIndex)}
                    aria-current={pageIndex === state.pageIndex ? 'page' : undefined}
                    aria-label={`Go to page ${pageIndex + 1}${pageIndex === state.pageIndex ? ', current page' : ''}`}
                  >
                    {thumbnail?.kind === 'ready'
                      ? <img src={thumbnail.src} alt={`Thumbnail preview of page ${pageIndex + 1}`} />
                      : <span className="thumbnail-placeholder">{thumbnail?.kind === 'error' ? 'Preview unavailable' : 'Rendering preview…'}</span>}
                    <span>Page {pageIndex + 1}</span>
                  </button>;
                })}
            </div>
          </section>
        </aside>}
        <section className="reader-stage" aria-label="PDF page preview">
          <div className="pdf-page" hidden={state.kind !== 'ready' && state.kind !== 'loading'}>
            <canvas ref={canvasRef} aria-label="Rendered PDF page" />
            <div ref={textLayerRef} className="textLayer" aria-label="Selectable text from the rendered PDF page" />
          </div>
        </section>
      </div>
      <p className="reader-boundary">This reader renders a selected local or HTTPS URL PDF one page at a time. It includes PDF-provided outlines and nearby-page thumbnails, but does not save files, support passwords, search, annotations, HTML import, or AI features.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReaderPage />);
