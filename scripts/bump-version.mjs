#!/usr/bin/env node
// Sets the app version in every place that carries it.
//
//   npm run bump 2.9.1          stable version: app files, Cargo, READMEs, issue templates, website
//   npm run bump 2.10.0-rc.1    pre-release: app files and Cargo only (READMEs and website keep the stable version)
//   npm run bump -- --check     only check that the app files agree, change nothing
//   npm run bump -- 2.9.1 --dry-run   show what would change
//
// Files are edited as text so their formatting stays as it is. The Virtual Machine (vm/) has its own versioning
// and is not touched. The GitHub workflow "Bump version" (.github/workflows/bump-version.yml) runs this script and
// opens a pull request.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const V = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.]+)?';

/**
 * Each target: file, regular expression with the version in group 2, number of expected matches, and whether it
 * belongs to the app (always bumped) or to the public stable version (READMEs, website: stable versions only).
 */
const TARGETS = [
  { file: 'package.json', re: new RegExp(`^(  "version": ")(${V})(")`, 'm'), count: 1, app: true },
  // root version and packages[""].version
  { file: 'package-lock.json', re: new RegExp(`^(  "version": ")(${V})(")|^(      "version": ")(${V})(")(?=,\\n      "license")`, 'gm'), count: 2, app: true },
  { file: 'src-tauri/tauri.conf.json', re: new RegExp(`^(  "version": ")(${V})(")`, 'm'), count: 1, app: true },
  { file: 'src-tauri/Cargo.toml', re: new RegExp(`(\\[package\\]\\nname = "kizamubeam"\\nversion = ")(${V})(")`), count: 1, app: true },
  { file: 'src-tauri/core/Cargo.toml', re: new RegExp(`(\\[package\\]\\nname = "kizamubeam-core"\\nversion = ")(${V})(")`), count: 1, app: true },
  { file: 'src-tauri/Cargo.lock', re: new RegExp(`(name = "kizamubeam(?:-core)?"\\nversion = ")(${V})(")`, 'g'), count: 2, app: true },
  { file: 'README.md', re: /(Current version: \*\*)(\d+\.\d+\.\d+)(\*\*)/, count: 1 },
  { file: 'README.de.md', re: /(Aktuelle Version: \*\*)(\d+\.\d+\.\d+)(\*\*)/, count: 1 },
  { file: 'README.it.md', re: /(Versione attuale: \*\*)(\d+\.\d+\.\d+)(\*\*)/, count: 1 },
  { file: '.github/ISSUE_TEMPLATE/bug_report.yml', re: /(placeholder: e\.g\. )(\d+\.\d+\.\d+)(\b)/, count: 1 },
  { file: '.github/ISSUE_TEMPLATE/machine_report.yml', re: /(placeholder: e\.g\. )(\d+\.\d+\.\d+)( on )/, count: 1 },
  ...['de', 'en', 'it', 'pt'].map((l) => ({ file: `website/i18n/${l}.json`, re: new RegExp(`^(  "version": ")(${V})(")`, 'm'), count: 1 })),
];

/** All version strings a target currently contains, in order. */
function found(text, t) {
  const re = new RegExp(t.re.source, t.re.flags.includes('g') ? t.re.flags : t.re.flags + 'g');
  return [...text.matchAll(re)].map((m) => m[2] ?? m[5]);
}

function replace(text, t, version) {
  return text.replace(t.re, (...m) => (m[1] !== undefined ? m[1] + version + m[3] : m[4] + version + m[6]));
}

function fail(msg) {
  console.error(`bump: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const check = args.includes('--check');
const version = args.find((a) => !a.startsWith('--'))?.replace(/^v/, '');

const read = (f) => readFileSync(join(root, f), 'utf8');

if (check) {
  const seen = new Map();
  for (const t of TARGETS.filter((t) => t.app)) {
    for (const v of found(read(t.file), t)) seen.set(`${t.file}`, [...(seen.get(t.file) ?? []), v]);
  }
  const all = new Set([...seen.values()].flat());
  for (const [f, vs] of seen) console.log(`${vs.join(', ').padEnd(16)} ${f}`);
  if (all.size !== 1) fail(`app files disagree (${[...all].join(', ')}). Run: npm run bump <version>`);
  console.log(`All app files are at ${[...all][0]}.`);
  process.exit(0);
}

if (!version) fail('usage: npm run bump <version>   e.g. npm run bump 2.9.1 or npm run bump 2.10.0-rc.1');
if (!SEMVER.test(version)) fail(`"${version}" is not a version like 2.9.1 or 2.10.0-rc.1`);

const prerelease = version.includes('-');
const targets = TARGETS.filter((t) => t.app || !prerelease);
const changes = [];
for (const t of targets) {
  const text = read(t.file);
  const before = found(text, t);
  if (before.length !== t.count) {
    fail(`${t.file}: expected ${t.count} version entr${t.count === 1 ? 'y' : 'ies'}, found ${before.length}. Update scripts/bump-version.mjs.`);
  }
  const after = replace(text, t, version);
  changes.push({ file: t.file, before: [...new Set(before)].join(', ') });
  if (after !== text && !dryRun) writeFileSync(join(root, t.file), after);
}

for (const c of changes) console.log(`${c.before.padEnd(16)} → ${version}  ${c.file}`);
if (prerelease) console.log('Pre-release: READMEs, issue templates and website keep the stable version.');

if (!prerelease && !dryRun) {
  // website/*/index.html are generated from website/i18n
  execFileSync(process.execPath, [join(root, 'website/build.mjs')], { stdio: 'inherit' });
}
if (dryRun) console.log('Dry run, nothing written.');
