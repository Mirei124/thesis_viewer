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
  | { kind: 'ready'; fileName: string; pageCount: number }
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

function ReaderPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<ReaderState>({ kind: 'idle' });
  const [urlValue, setUrlValue] = useState('');

  useEffect(() => () => {
    abortControllerRef.current?.abort();
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

  function isCurrent(requestId: number) {
    return requestId === requestIdRef.current;
  }

  function beginImport() {
    requestIdRef.current += 1;
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

  async function renderFirstPage(bytes: Uint8Array, fileName: string, requestId: number) {
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
      const page = await pdf.getPage(1);
      if (!isCurrent(requestId)) return;
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
      if (!isCurrent(requestId)) return;
      setState({ kind: 'ready', fileName, pageCount: pdf.numPages });
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
      await renderFirstPage(bytes, file.name, requestId);
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
      await renderFirstPage(bytes, url.pathname.split('/').pop() || url.hostname, requestId);
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
        {state.kind === 'ready' && `${state.fileName}: page 1 of ${state.pageCount}. Text can be selected over the canvas.`}
        {state.kind === 'cancelled' && state.message}
        {state.kind === 'error' && state.message}
      </section>
      <section className="reader-stage" aria-label="PDF first page preview">
        <div className="pdf-page" hidden={state.kind !== 'ready' && state.kind !== 'loading'}>
          <canvas ref={canvasRef} aria-label="Rendered first PDF page" />
          <div ref={textLayerRef} className="textLayer" aria-label="Selectable text from the first PDF page" />
        </div>
      </section>
      <p className="reader-boundary">This spike renders only the first page of a selected local or HTTPS URL PDF. It does not save files, support passwords, navigation, zoom, search, outlines, thumbnails, annotations, HTML import, or AI features.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReaderPage />);
