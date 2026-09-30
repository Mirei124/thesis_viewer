import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, rm, stat, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser) || process.argv.length !== 3) {
  console.error('Usage: node scripts/package-extension.mjs <chrome|firefox>');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.output');
const dist = resolve(root, 'dist');
const { name, version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const zip = resolve(output, `${name}-${version}-${browser}.zip`);
const distZip = resolve(dist, `${name}-${version}-firefox.zip`);
const crx = resolve(output, 'chrome-mv3.crx');
const generatedKey = resolve(output, 'chrome-mv3.pem');
const distCrx = resolve(dist, `${name}-${version}-chrome.crx`);
const distKey = resolve(dist, `${name}-chrome.pem`);

// Keep newly generated private keys private even if Chromium uses permissive defaults.
process.umask(0o077);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function requireNonempty(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty package artifact: ${path}`);
}

async function hasFile(path) {
  return stat(path).then((info) => info.isFile(), (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

async function copyArtifact(source, target, mode) {
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    await copyFile(source, temporary);
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (!directory) continue;
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
  }
  throw new Error('Chromium/Chrome not found on PATH; set CHROME_BIN to the browser executable');
}

async function main() {
  await mkdir(dist, { recursive: true });
  let keyExists = false;
  if (browser === 'chrome') {
    keyExists = await hasFile(distKey);
    if (keyExists) {
      await requireNonempty(distKey);
      await chmod(distKey, 0o600);
    } else if (await hasFile(generatedKey)) {
      await requireNonempty(generatedKey);
      await chmod(generatedKey, 0o600);
      await copyArtifact(generatedKey, distKey, 0o600);
      keyExists = true;
    }
  }
  await rm(zip, { force: true });
  if (browser === 'chrome') {
    await rm(distCrx, { force: true });
    await rm(crx, { force: true });
  } else {
    await rm(distZip, { force: true });
    await rm(resolve(output, `${name}-${version}-sources.zip`), { force: true });
  }

  await run('pnpm', ['exec', 'wxt', 'zip', '--browser', browser]);
  await requireNonempty(zip);

  if (browser === 'firefox') {
    await requireNonempty(resolve(output, `${name}-${version}-sources.zip`));
    await copyArtifact(zip, distZip);
    console.log(`Firefox package: ${distZip}`);
    return;
  }

  const chromium = await findChromium();
  const args = [`--pack-extension=${resolve(output, 'chrome-mv3')}`];
  if (keyExists) args.push(`--pack-extension-key=${distKey}`);
  await run(chromium, args);
  await requireNonempty(crx);
  if (!keyExists) {
    await requireNonempty(generatedKey);
    await copyArtifact(generatedKey, distKey, 0o600);
    await chmod(generatedKey, 0o600);
  }
  await copyArtifact(crx, distCrx);
  console.log(`Chromium package: ${distCrx}`);
  console.log(`Chromium private key: ${distKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
