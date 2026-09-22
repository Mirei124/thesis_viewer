# Thesis Viewer

Thesis Viewer is a local-first, independent paper-reading extension for Chrome and Firefox. It currently has a WXT, TypeScript, and React runtime skeleton plus a deliberately small PDF.js feasibility spike.

## Current scope

The built extension provides these extension pages:

- `reader.html`: choose one local PDF and render only its first page to a canvas with PDF.js's selectable text layer. PDF.js and its worker are bundled into the extension; the reader page owns the worker and makes no remote PDF/worker request.
- `options.html`: a clear placeholder for future model settings. It neither stores nor sends any configuration.

The manifest declares no browser permissions or host permissions. There are no content scripts, background scripts, remote scripts, browser-wide injections, or network requests in this milestone. The reader only accepts a user-selected local file for the current page session and does not persist it.

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

The UI reports no selected file, loading, successful first-page rendering, non-PDF input, invalid/damaged PDF, password-protected PDF, and unexpected PDF.js failures. It does not implement password entry, file persistence, page navigation, zoom, rotation, outlines, thumbnails, search, annotations, HTML/URL import, structured extraction, or AI features.

Actual checks recorded for this batch on 2026-09-22: `pnpm typecheck`, `pnpm build:chrome`, and `pnpm build:firefox` passed. Both browser outputs contain a local `assets/pdf.worker.min-*.mjs` worker asset. A local text PDF is available for a real-browser check, but the extension has not yet been successfully loaded by this batch: the available Playwright Chromium session blocks `file:` URLs and has no Chrome distribution, while a direct system Chromium headless launch did not remain available for DevTools connection. A successful build does not stand in for PDF rendering validation.

## Browser target

Both build commands explicitly request Manifest V3. The Firefox manifest includes a development Gecko extension ID and currently declares Firefox 121 as its minimum version. Actual Chrome/Firefox loading and compatibility evidence must be recorded separately after a real-browser validation.
