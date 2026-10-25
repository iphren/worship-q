// Keeps the desktop app's version the same everywhere it is written down.
//
//   node scripts/version.mjs check          fails when the files disagree
//   node scripts/version.mjs bump 1.2.3     writes 1.2.3 to every file
//
// apps/desktop/package.json is the source: tauri.conf.json reads it, and the bundle and the
// updater take their version from there. The others are kept equal so nothing reports another.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Each file the version lives in, with how to read and replace it. */
const files = [
  jsonVersion('apps/desktop/package.json'),
  jsonVersion('package.json'),
  {
    path: 'apps/desktop/src-tauri/Cargo.toml',
    // The first `version` under `[package]`.
    pattern: /(\[package\][^[]*?\nversion = ")([^"]+)(")/,
  },
  {
    path: 'apps/desktop/src-tauri/Cargo.lock',
    pattern: /(\[\[package\]\]\nname = "worship-q"\nversion = ")([^"]+)(")/,
  },
];

function jsonVersion(path) {
  // The top-level `"version"`, which comes before any nested object in these files.
  return { path, pattern: /^(\{[^{]*?\n {2}"version": ")([^"]+)(")/ };
}

function read(file) {
  const text = readFileSync(join(root, file.path), 'utf8');
  const match = file.pattern.exec(text);
  if (!match) throw new Error(`No version found in ${file.path}`);
  return { text, version: match[2] };
}

function check() {
  const found = files.map((file) => ({ path: file.path, version: read(file).version }));
  const expected = found[0].version;
  const wrong = found.filter((entry) => entry.version !== expected);
  if (wrong.length > 0) {
    for (const entry of wrong) {
      console.error(`${entry.path} has ${entry.version}, expected ${expected} (${found[0].path})`);
    }
    process.exit(1);
  }
  const tauri = JSON.parse(
    readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  );
  if (tauri.version !== '../package.json') {
    console.error('tauri.conf.json must set "version": "../package.json"');
    process.exit(1);
  }
  console.log(`Version ${expected} everywhere`);
}

function bump(version) {
  if (!SEMVER.test(version ?? '')) {
    console.error('Usage: node scripts/version.mjs bump <major.minor.patch>');
    process.exit(1);
  }
  for (const file of files) {
    const { text } = read(file);
    writeFileSync(join(root, file.path), text.replace(file.pattern, `$1${version}$3`));
  }
  console.log(`Set version ${version}`);
}

const [command, argument] = process.argv.slice(2);
if (command === 'check') check();
else if (command === 'bump') bump(argument);
else {
  console.error('Usage: node scripts/version.mjs check | bump <version>');
  process.exit(1);
}
