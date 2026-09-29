import { access, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputNames = { chrome: 'chrome-mv3', firefox: 'firefox-mv3' };
const browser = process.argv[2];
const outputName = outputNames[browser];
if (!outputName) throw new Error('Expected one build target: chrome or firefox.');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, '.output', outputName);
await access(join(output, 'manifest.json'));
await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'));
console.log(`Copied LICENSE into .output/${outputName}/`);
