# Thesis Viewer

Thesis Viewer is a local-first, independent paper-reading extension for Chrome and Firefox, built with WXT, TypeScript, React, and a bundled PDF.js worker.

## Current scope

The built extension provides these extension pages:

- `reader.html`: choose a local PDF or submit an HTTPS URL that actually returns PDF bytes (up to 100 MiB and 500 pages). Read continuously across pages with an outline, a full page-thumbnail rail, search, page jumps, 25–400% zoom, and 90-degree rotation. The latest zoom percentage or fit mode is saved locally and shared by all PDFs, including newly opened documents; each PDF retains its own reading page and rotation. Canvas, selectable text, and native PDF link regions use the same PDF.js viewport, including the PDF page’s own rotation. HTTP(S) links open in a new tab; named and explicit internal destinations navigate within the reader. Native links remain available on every page of the continuous document, while recognized bibliography markers keep their citation popovers. Citation cards emphasize locally identifiable titles, show available author/year/publication details, and keep the full source entry in an expandable disclosure; uncertain entries remain visible as their original text. Selecting text opens a toolbar for a manual highlight in one of four colors or a Chinese/English translation. Translation sends selected text and its bounded context only after an explicit click and endpoint permission; completed results can be reopened for the same PDF version. The reader builds a local evidence ledger for independent three-line and six-part detailed overview requests. Overviews use Chinese narrative while preserving source English proper names and technical terminology, including original spelling, capitalization, and abbreviations. Two settings optionally generate either overview automatically when a PDF opens; both are off by default. Automatic generation waits for local evidence and cache checks, uses already-granted API host access, and skips valid cached results. Factual result blocks are checked against local evidence IDs and locations; completed, validated overviews are cached locally and rechecked against the current ledger before restoration. Highlights are stored locally by PDF content version. PDF.js and its worker are bundled into the extension.
- `options.html`: configure a compatible API base URL, model ID, structured-output capability, and context/output limits. New installations default to `https://api.deepseek.com/v1`, `deepseek-flash`, structured output enabled, and a 32,000-token output limit; saved settings remain in effect. The URL must be HTTPS, except for an explicitly entered `http://localhost` or `http://127.0.0.1` endpoint. The supplied API prefix is preserved (no `/v1` is guessed). Non-secret settings are stored in extension `storage.local`. An API key normally uses trusted extension-only `storage.session`, so the reader can use it in the same browser session without writing it to disk; **Remember this key on this device** moves it to `storage.local`. The clear control removes either form. Every reader model action uses the compatible `/chat/completions` primitive and maps the configured output limit to the OpenAI-compatible `max_tokens` field. If **Structured output supported** is enabled, it explicitly sends `response_format: { type: "json_object" }`; it is otherwise omitted, with no model-name inference or protocol fallback.

The manifests declare `storage`, `webNavigation`, `activeTab`, and `contextMenus`, with no persistent host permissions. Public `https://*/*` plus `http://localhost/*` and `http://127.0.0.1/*` are optional host permissions only; imports and manual model actions request the specific host when needed. Enabling automatic overviews requests the configured API host while saving settings; opening a PDF checks existing permission without requesting new access. PDF download omits website cookies. The compatible provider sends only caller-supplied messages, uses Bearer authorization only when a key is present, and requests a non-streaming JSON response. Chrome builds use a service worker; Firefox builds use a non-persistent background script. Both builds include extension icons at 16, 32, 48, and 128 pixels. When the user has enabled auto-open and already granted the arXiv host permission, the background listener redirects only top-level `https://arxiv.org/pdf/` routes to the reader. The reader still validates the response as PDF and rejects HTML; `/html`, `/abs`, landing pages, and other hosts are not intercepted. There are no content scripts, remote scripts, or browser-wide injections. IndexedDB retains highlight anchors, completed translations, and verified overview results by PDF content version; it does not retain PDFs, extracted full text, API keys, authorization headers, or conversation history.

Clicking the toolbar icon opens the current tab in the reader when its address is an HTTPS `.pdf` URL or an arXiv `/pdf/<id>` route. The extension requests access only to that PDF host at click time. Other addresses show a visible “not a PDF” page; the reader still checks downloaded bytes before accepting a PDF. The extension icon’s native menu includes **打开阅读器** (Open reader) and **设置** (Settings), which open the corresponding extension pages in new tabs.

## Development

Install dependencies with pnpm, then run the checks and browser-specific builds:

```sh
pnpm install
pnpm typecheck
pnpm build:chrome
pnpm build:firefox
```

WXT writes Chrome output to `.output/chrome-mv3/` and Firefox output to `.output/firefox-mv3/`; each build copies the root `LICENSE` into its output directory. Open `reader.html` from the loaded extension's URL to use the reader. The extension management page's options command opens `options.html` in its own tab.

## Package for distribution

Run `pnpm package` to build both browsers. It creates `dist/thesis-viewer-<version>-chrome.crx`, `dist/thesis-viewer-chrome.pem`, and `dist/thesis-viewer-<version>-firefox.zip`. The script reuses the PEM on later runs so the Chrome extension ID stays stable. Keep a secure backup of the PEM, and never publish or send it with the CRX. You can run `pnpm package:chrome` or `pnpm package:firefox` for one target; set `CHROME_BIN` to the Chromium/Chrome executable if it is not discoverable on `PATH`.

WXT also keeps the browser extension ZIP archives under `.output/`, plus a separate Firefox sources ZIP containing the files needed to rebuild the extension for add-on review. The archives contain bundled assets, icons, and `LICENSE` at the root. `dist/` and `.output/` are ignored by Git.

Chrome users can load the unpacked build locally; persistent installation in Firefox release/beta requires [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). The Firefox sources archive is for review and is not an installable extension. The Firefox ZIP in `dist/` is unsigned.

To inspect the detailed overview's local evidence packets without a model or browser, use Node 22+ with one or more local PDFs:

```sh
pnpm replay:evidence -- /absolute/path/paper.pdf /absolute/path/another.pdf > /tmp/evidence-replay.json
```

The JSON lists each document's three-line input packet and six detailed stages, source counts and limits, total excerpt lengths, and each source's alias, section, excerpt, length, and original evidence IDs. The command revalidates every alias against its PDF.js text block and exits nonzero if a PDF fails or a source exceeds its budget. It reads PDFs locally and makes no API request; it does not save PDFs or keys.

## Load the built extension

The `.output/` directories are build artifacts, ignored by Git, and are intended for local development loading.

- Chrome: open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose `.output/chrome-mv3/`.
- Firefox: open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `.output/firefox-mv3/manifest.json`. Firefox removes a temporary add-on after restart.

Open `reader.html` from the extension details page or its extension URL. The extension management page opens Settings (`options.html`) as an independent tab; configure a compatible provider there before requesting translation or a new overview. Do not put API keys in screenshots, issue reports, or commits.

## PDF behavior and limits

`pdfjs-dist` is installed as a local dependency. The reader imports `pdfjs-dist/build/pdf.worker.min.mjs?url`, so WXT emits a local worker asset in each browser build and PDF.js receives that extension-local URL through `GlobalWorkerOptions.workerSrc`. No CDN or remote worker URL is used.

The reader rejects inputs larger than 100 MiB before local-file reads, from URL response metadata when available, and while streaming URL bytes. It opens the PDF only far enough to reject documents above 500 pages, before rendering, outline work, thumbnails, or full-text indexing begin. The UI reports no selected file, permission denial, loading, cancellation, successful page rendering, HTTP/network errors, HTML/non-PDF input, invalid/damaged PDF, password-protected PDF, and unexpected PDF.js failures. Password entry/decryption is deliberately unavailable. If PDF.js cannot extract any text (for example, a scanned PDF), page rendering remains available while the full-document search field and navigation are disabled with an explicit explanation; no text has been falsely indexed. Outline destinations are resolved through PDF.js and unresolved entries remain on the current page with an explanation; PDFs without an outline say so directly. Manual highlights capture the selected quote plus PDF-coordinate rectangles, so they redraw with the current page at every supported zoom and rotation. Their local IndexedDB records are keyed by a SHA-256 content version, restore only for the same content, and can be cleared for that document. Successful translations are retained only under that same stable content version and can be reopened locally; API keys, authorization headers, and unfinished output are never stored. Reloading or closing the reader marks active translation checkpoints interrupted and never sends a replacement request. Storage failures are shown while the in-memory highlight remains usable. Highlights do not cross pages and do not create notes, citations, automatic highlights, or automatic AI requests. Starting a new import, pressing Cancel, or choosing another page/view invalidates an older render so it cannot replace the current reader state. It does not implement OCR, PDF/full-text persistence, HTML import, webpage scraping, or cloud sync. Model requests require a manual action or an explicitly enabled automatic-overview setting.

The current static audit ran 187 unit tests, typecheck, both browser builds, and `git diff --check`. Both builds retain the known non-blocking warning that the reader JavaScript chunk exceeds 500 kB. Users have exercised the M8 main reading flow in normal Chromium and Firefox, including local and direct-URL PDFs, language/theme controls, and Insights. The B068–B072 quality reviews checked five public PDFs with offline evidence replay and generated detailed overviews in Chromium, including a verified formula from arXiv 2609.35457. Earlier browser checks covered translation, overviews, Evidence navigation, HTML rejection, and permission denial. A successful build does not substitute for browser evidence or prove the untested boundary samples below.

## Verify URL import in a browser

For Chrome, run `pnpm build:chrome`, load `.output/chrome-mv3/` through `chrome://extensions` with Developer mode enabled, then open the extension's `reader.html` (not a `file:` URL). Verify the following in one normal browser profile:

1. Choose a local PDF and confirm the first page and selectable text render; exercise Next, Page, zoom, and rotation.
2. Enter `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`, choose **Import URL**, approve the prompt for `www.w3.org`, and confirm the same rendering/text behavior.
3. Enter `https://example.com/`, approve its one-host prompt, and confirm the reader reports that HTML was returned instead of a PDF. It must not render or scrape that page. This is the HTML boundary check; HTML paper pages such as `arxiv.org/html` are intentionally unsupported.
4. In Settings, use the already trusted compatible-model configuration. Translate a short selected sentence, then request the three-line and detailed overviews. Confirm results render and Evidence chips still navigate in the PDF. Do not enter an API key in a screenshot or report.

For the denial path, use a fresh profile or remove the extension's previously granted host access, dismiss the URL permission prompt, and confirm that the reader reports denial without downloading. HTTP/network errors and cancellation should remain errors/cancelled states rather than falling back to webpage import.

## Browser target and evidence

Both build commands explicitly request Manifest V3. The Firefox manifest includes a development Gecko extension ID and declares Firefox 121 as its minimum version. Exact browser versions were not recorded during manual validation, so the matrix records evidence rather than an unsupported version claim.

| Target | Manifest/build target | Runtime evidence | Version boundary |
|---|---|---|---|
| Chrome | MV3; `.output/chrome-mv3/` | User completed the M7 critical-path regression: local and URL PDF, HTML rejection, translation, both overviews, Evidence-chip navigation, and denied host permission. | Exact tested Chrome version was not recorded. |
| Firefox | MV3; `.output/firefox-mv3/` | User validated reading, URL-PDF import, provider settings, translation, and real-model overview flows across the implementation batches. | Manifest declares Firefox 121+; exact tested Firefox version was not recorded. |

## Known verification boundaries

- No runtime sample has yet verified a textless/scanned PDF, password-protected PDF, damaged PDF, or a PDF above the 100 MiB/500-page limits. Their designed error/degradation paths are not evidence of a tested sample.
- Only an actual PDF response is supported for URL import. HTML paper pages and landing pages, including `arxiv.org/html`, are rejected and never scraped or summarized.
- The two current browser builds emit a non-blocking warning because the reader chunk is larger than 500 kB (about 582 kB in the audited output). This audit intentionally does not split or redesign it.

## License status

This project is licensed under [GNU GPL v3.0 only](LICENSE) (`GPL-3.0-only`); each browser build includes an identical `LICENSE` file. Before publishing a build, review the licenses of bundled dependencies, including PDF.js.
