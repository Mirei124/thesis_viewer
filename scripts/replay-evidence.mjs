#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Node 22 can strip TypeScript syntax. The app's extensionless relative
// imports need a local .ts resolver; package imports keep Node's resolver.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { pageBlocksFromTextContent } = await import('../src/lib/pdfPageBlocks.ts');
const { replayDetailedEvidenceFromPages } = await import('../src/lib/offlineEvidenceReplay.ts');

const args = process.argv.slice(2);
const inputPaths = args[0] === '--' ? args.slice(1) : args;
if (inputPaths.length === 0 || inputPaths.includes('--help')) {
  console.log('Usage: pnpm replay:evidence -- /absolute/path/paper.pdf [another.pdf ...]');
  process.exit(inputPaths.includes('--help') ? 0 : 2);
}

const documents = [];
const errors = [];
for (const inputPath of inputPaths) {
  const pdfPath = resolve(inputPath);
  let loadingTask;
  try {
    const bytes = await readFile(pdfPath);
    const documentVersion = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    loadingTask = getDocument({ data: new Uint8Array(bytes),
      standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)) });
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        pages.push(pageBlocksFromTextContent(await page.getTextContent(), pageIndex, documentVersion));
      } catch (error) {
        pages.push({ pageIndex, blocks: [], searchableText: '', textItemCount: 0,
          status: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    }
    documents.push({ pdfPath, ...replayDetailedEvidenceFromPages(pages, documentVersion) });
  } catch (error) {
    errors.push({ pdfPath, message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (loadingTask) await loadingTask.destroy();
  }
}

console.log(JSON.stringify({ formatVersion: 1, documents, errors }, null, 2));
if (errors.length) process.exitCode = 1;
