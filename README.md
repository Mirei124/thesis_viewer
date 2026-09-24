# Thesis Viewer

Thesis Viewer is a local-first, independent paper-reading extension for Chrome and Firefox. It currently has a WXT, TypeScript, and React runtime skeleton plus a deliberately small PDF.js feasibility spike.

## Current scope

The built extension provides these extension pages:

- `reader.html`: choose one local PDF or explicitly submit an HTTPS PDF URL (up to 100 MiB and 500 pages), then read it with page navigation, page-number jumps, zoom, and 90-degree rotation. It displays the PDF's native outline when present and low-cost previews only for the current and adjacent pages. Each rendered canvas and selectable text layer use the same PDF.js viewport. Selecting text on the visible page opens a toolbar to create a manual highlight in one of four colors; clicking a highlight changes its color or deletes it. Highlights are stored locally by the PDF content version and can be cleared for the current PDF. PDF.js and its worker are bundled into the extension.
- `options.html`: a clear placeholder for future model settings. It neither stores nor sends any configuration.

The manifest declares no regular permissions or persistent host permissions. It declares `https://*/*` only as an optional host permission. A URL is not fetched until the reader user submits it: the browser then asks for permission to the submitted HTTPS host, and the reader downloads that exact URL without website cookies. The response must have a PDF signature; HTML sign-in/landing pages and other non-PDF responses are rejected. There are no content scripts, background scripts, remote scripts, browser-wide injections, or model requests in this milestone. IndexedDB retains only user highlight IDs, document content versions, PDF-coordinate anchors, quotes, colors, and timestamps; it does not retain PDFs, extracted full text, AI results, or cloud data.

## Development

Install dependencies with pnpm, then run the checks and browser-specific builds:

```sh
pnpm install
pnpm typecheck
pnpm build:chrome
pnpm build:firefox
```

WXT writes Chrome output to `.output/chrome-mv3/` and Firefox output to `.output/firefox-mv3/`. Open `reader.html` from the loaded extension's URL to view the reader placeholder. The browser options command opens `options.html` because it is registered as `options_ui`.

## Current PDF spike and its limits

`pdfjs-dist` is installed as a local dependency. The reader imports `pdfjs-dist/build/pdf.worker.min.mjs?url`, so WXT emits a local worker asset in each browser build and PDF.js receives that extension-local URL through `GlobalWorkerOptions.workerSrc`. No CDN or remote worker URL is used.

The reader rejects inputs larger than 100 MiB before local-file reads, from URL response metadata when available, and while streaming URL bytes. It opens the PDF only far enough to reject documents above 500 pages, before rendering, outline work, thumbnails, or full-text indexing begin. The UI reports no selected file, permission denial, loading, cancellation, successful page rendering, HTTP/network errors, HTML/non-PDF input, invalid/damaged PDF, password-protected PDF, and unexpected PDF.js failures. Password entry/decryption is deliberately unavailable. If PDF.js cannot extract any text (for example, a scanned PDF), page rendering remains available while the full-document search field and navigation are disabled with an explicit explanation; no text has been falsely indexed. Outline destinations are resolved through PDF.js and unresolved entries remain on the current page with an explanation; PDFs without an outline say so directly. Manual highlights capture the selected quote plus PDF-coordinate rectangles, so they redraw with the current page at every supported zoom and rotation. Their local IndexedDB records are keyed by a SHA-256 content version, restore only for the same content, and can be cleared for that document. Storage failures are shown while the in-memory highlight remains usable. Highlights do not cross pages and do not create notes, citations, automatic highlights, or AI requests. Starting a new import, pressing Cancel, or choosing another page/view invalidates an older render so it cannot replace the current reader state. It does not implement OCR, PDF/full-text persistence, HTML import, structured extraction, or AI features.

Actual checks through B004 on 2026-09-22: `pnpm typecheck`, `pnpm build:chrome`, and `pnpm build:firefox` passed. Chromium 153 and Firefox 155 were each used to load the actual extension and render a local PDF with a selectable text layer. For URL import, Chromium 153 loaded the built extension and submitted `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`; before approval, `chrome.permissions.contains` for `https://www.w3.org/*` returned false and no request to that host appeared. Headless Chromium leaves the browser permission prompt pending, so an approved download/render, denial, HTTP/non-PDF, cancellation, and Firefox URL-import check remain unverified. A successful build does not stand in for those tests.

## Verify URL import in a browser

Load the browser-specific build as a temporary extension, then open its extension URL for `reader.html` (not a `file:` URL). Enter `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` and choose **Import URL**. Approve the browser prompt for `www.w3.org`; the reader should render the first page with selectable text. Use **Next page**, the **Page** field, zoom, and both rotation controls to verify that the canvas and selectable text remain aligned. Test denial by dismissing the prompt in a fresh browser profile or after removing the granted site access; the reader should state that permission was denied and should not issue a download. A URL that serves an HTML page or an HTTP error should remain an error and suggest local-file import.

## Browser target

Both build commands explicitly request Manifest V3. The Firefox manifest includes a development Gecko extension ID and currently declares Firefox 121 as its minimum version. Actual Chrome/Firefox loading and compatibility evidence must be recorded separately after a real-browser validation.
