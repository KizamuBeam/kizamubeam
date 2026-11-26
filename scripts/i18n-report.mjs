// Collects missing translations of the app, the website and the manual, grouped by language.
// Used by .github/workflows/i18n-issues.yml, which opens one issue per language.
// Run: npm run i18n:report  (prints a summary)
//      node scripts/i18n-report.mjs --out report.json [--repo-url https://github.com/o/r --sha <commit>] [--markdown dir]
//
// Sources: app texts are German in the code (src/locales/<lang>.json, checked by scripts/i18n-check.mjs),
// website texts are website/i18n/de.json, the manual is English (manual/docs, translations in manual/i18n/<lang>).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : '';
};
const posix = (p) => p.split(path.sep).join('/');

/** Language group of a code: the primary subtag, so website "pt" and app "pt-BR" share one issue. */
const group = (code) => code.split('-')[0].toLowerCase();
const languageName = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** @type {Map<string, { code: string, name: string, areas: any[] }>} */
const languages = new Map();
const addArea = (code, area) => {
  const g = group(code);
  if (!languages.has(g)) languages.set(g, { code: g, name: languageName(g), areas: [] });
  languages.get(g).areas.push({ code, ...area });
};

// ---- App: scripts/i18n-check.mjs --json ----
{
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-')), 'app.json');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/i18n-check.mjs'), '--json', tmp], { encoding: 'utf8' });
  if (!fs.existsSync(tmp)) {
    process.stderr.write(r.stdout + r.stderr);
    throw new Error('scripts/i18n-check.mjs did not write its report');
  }
  const app = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  for (const [code, x] of Object.entries(app))
    addArea(code, {
      area: 'app',
      title: 'App',
      file: x.file,
      total: x.keys,
      missing: x.missing.map((m) => {
        const [file, line] = m.where.split(/:(\d+)$/);
        return { key: m.key, file: file.replace(/ \(.*\)$/, ''), line: line ? Number(line) : undefined };
      }),
      wrong: x.wrongVars.map((w) => ({ key: w.key, value: w.value })),
      unused: x.unused.length,
      fix: '`npm run i18n:check -- --write` adds the missing texts with empty values; then fill them in. The keys are the German texts.',
    });
}

// ---- Website: website/i18n/<lang>.json against de.json ----
{
  const dir = path.join(root, 'website/i18n');
  const flat = (v, p = '', out = new Map()) => {
    if (Array.isArray(v)) v.forEach((x, i) => flat(x, `${p}[${i}]`, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flat(x, p ? `${p}.${k}` : k, out);
    else out.set(p, v);
    return out;
  };
  const source = flat(JSON.parse(fs.readFileSync(path.join(dir, 'de.json'), 'utf8')));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'de.json').sort()) {
    const code = f.slice(0, -5);
    const dict = flat(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const missing = [...source].filter(([k, v]) => v !== '' && v != null && (dict.get(k) === undefined || dict.get(k) === '')).map(([key]) => ({ key, file: `website/i18n/${f}` }));
    addArea(code, {
      area: 'website',
      title: 'Website',
      file: `website/i18n/${f}`,
      total: source.size,
      missing,
      wrong: [],
      unused: 0,
      fix: 'Add the entries (same path as in `website/i18n/de.json`), then run `node website/build.mjs`.',
    });
  }
}

// ---- Manual: pages and sidebar categories of manual/docs in manual/i18n/<lang> ----
{
  const manual = path.join(root, 'manual');
  const config = fs.readFileSync(path.join(manual, 'docusaurus.config.ts'), 'utf8');
  const def = /defaultLocale:\s*['"]([^'"]+)['"]/.exec(config)?.[1] ?? 'en';
  const locales = [...(/locales:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((l) => l !== def);
  const docs = path.join(manual, 'docs');
  const files = fs
    .readdirSync(docs, { recursive: true })
    .map(posix)
    .sort();
  const pages = files.filter((f) => /\.mdx?$/.test(f));
  const categories = [];
  for (const f of files.filter((f) => path.basename(f) === '_category_.json')) {
    const c = JSON.parse(fs.readFileSync(path.join(docs, f), 'utf8'));
    if (!c.label) continue;
    categories.push({ key: `sidebar.manual.category.${c.label}`, file: `manual/docs/${f}` });
    if (c.link?.type === 'generated-index' && c.link.description)
      categories.push({ key: `sidebar.manual.category.${c.label}.link.generated-index.description`, file: `manual/docs/${f}` });
  }
  for (const code of locales) {
    const base = path.join(manual, 'i18n', code, 'docusaurus-plugin-content-docs');
    const current = path.join(base, 'current.json');
    const labels = fs.existsSync(current) ? JSON.parse(fs.readFileSync(current, 'utf8')) : {};
    const missing = [
      ...pages.filter((p) => !fs.existsSync(path.join(base, 'current', p))).map((p) => ({ key: `manual/i18n/${code}/docusaurus-plugin-content-docs/current/${p}`, file: `manual/docs/${p}`, page: true })),
      ...categories.filter((c) => !labels[c.key]?.message).map((c) => ({ ...c })),
    ];
    addArea(code, {
      area: 'manual',
      title: 'Manual',
      file: `manual/i18n/${code}`,
      total: pages.length + categories.length,
      missing,
      wrong: [],
      unused: 0,
      fix: `Translate the pages from \`manual/docs\` into \`manual/i18n/${code}/docusaurus-plugin-content-docs/current\` (same path). Sidebar labels go into \`current.json\` there.`,
    });
  }
}

// ---- Markdown ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;');
/** Inline code span that survives any backticks in the text; line breaks show as \n. */
const code = (s) => {
  const text = JSON.stringify(String(s)).slice(1, -1).replace(/\\"/g, '"');
  const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  const pad = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
};
const repoUrl = arg('--repo-url');
const sha = arg('--sha');
const link = (file, line) => {
  const text = line ? `${file}:${line}` : file;
  if (!repoUrl || !sha) return `\`${text}\``;
  return `[${esc(text)}](${repoUrl}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''})`;
};

/** Issue body for one language; `limit` = entries listed per area. The hash covers only the findings. */
export function markdown(lang, limit = 300) {
  const count = lang.areas.reduce((n, a) => n + a.missing.length + a.wrong.length, 0);
  const lines = [];
  lines.push(`Translations into **${lang.name}** (\`${lang.code}\`) that are missing or need a fix. Found automatically by the *Missing translations* workflow (\`.github/workflows/i18n-issues.yml\`). This issue is updated on every change and closed once everything is translated.`, '');
  lines.push('| Area | File | Missing | Wrong placeholders |', '| --- | --- | ---: | ---: |');
  for (const a of lang.areas) lines.push(`| ${a.title} | \`${a.file}\` | ${a.missing.length} of ${a.total} | ${a.wrong.length || '–'} |`);
  for (const a of lang.areas) {
    if (!a.missing.length && !a.wrong.length) continue;
    lines.push('', `### ${a.title}: \`${a.file}\``, '', a.fix);
    if (a.missing.length) {
      const one = a.missing.length === 1;
      const what = a.area === 'manual' ? (one ? 'missing page or label' : 'missing pages and labels') : one ? 'missing text' : 'missing texts';
      lines.push('', `<details${a.missing.length <= 30 ? ' open' : ''}><summary>${a.missing.length} ${what}</summary>`, '');
      for (const m of a.missing.slice(0, limit)) {
        if (a.area === 'app') lines.push(`- ${code(m.key)} (${link(m.file, m.line)})`);
        else if (m.page) lines.push(`- Page ${link(m.file)}`);
        else if (a.area === 'manual') lines.push(`- Sidebar label ${code(m.key)} (${link(m.file)})`);
        else lines.push(`- ${code(m.key)}`);
      }
      if (a.missing.length > limit) lines.push(`- … and ${a.missing.length - limit} more. Run \`npm run i18n:report\` for the full list.`);
      lines.push('', '</details>');
    }
    if (a.wrong.length) {
      lines.push('', `<details open><summary>${a.wrong.length} ${a.wrong.length === 1 ? 'text' : 'texts'} with wrong placeholders</summary>`, '', 'The `{…}` placeholders of the translation must match the German text.', '');
      for (const w of a.wrong.slice(0, limit)) lines.push(`- ${code(w.key)} → ${code(w.value)}`);
      if (a.wrong.length > limit) lines.push(`- … and ${a.wrong.length - limit} more.`);
      lines.push('', '</details>');
    }
  }
  const findings = JSON.stringify(lang.areas.map((a) => [a.file, a.missing.map((m) => m.key), a.wrong.map((w) => [w.key, w.value])]));
  const hash = createHash('sha256').update(findings).digest('hex').slice(0, 16);
  const footer = `<sub>Last changed at commit ${sha ? (repoUrl ? `[${sha.slice(0, 7)}](${repoUrl}/commit/${sha})` : sha.slice(0, 7)) : 'local'}.</sub>`;
  let body = [`<!-- i18n-missing:${lang.code} -->`, `<!-- i18n-hash:${hash} -->`, ...lines, '', footer].join('\n');
  // GitHub allows 65536 characters per issue body
  if (body.length > 60000 && limit > 10) return markdown(lang, Math.floor(limit / 2));
  return { count, hash, body, title: `Missing translations: ${lang.name} (${lang.code})` };
}

export function report() {
  return [...languages.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((lang) => ({ code: lang.code, name: lang.name, areas: lang.areas.map((a) => ({ area: a.area, code: a.code, file: a.file, total: a.total, missing: a.missing.length, wrong: a.wrong.length })), ...markdown(lang) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = report();
  for (const l of out) {
    console.log(`${l.name} (${l.code}): ${l.count} to do`);
    for (const a of l.areas) console.log(`  ${a.area.padEnd(8)} ${a.file.padEnd(28)} ${a.missing} missing of ${a.total}${a.wrong ? `, ${a.wrong} wrong placeholders` : ''}`);
  }
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 2) + '\n');
  if (arg('--markdown')) {
    fs.mkdirSync(arg('--markdown'), { recursive: true });
    for (const l of out) fs.writeFileSync(path.join(arg('--markdown'), `${l.code}.md`), l.body + '\n');
  }
}
