// Keeps one GitHub issue per language in sync with scripts/i18n-report.mjs:
// opens an issue when translations are missing, updates its body when the list changes
// and closes it once everything is translated. Called from .github/workflows/i18n-issues.yml
// through actions/github-script, which passes `github` (Octokit), `context` and `core`.
// Issues are found by their label and the hidden marker <!-- i18n-missing:<lang> --> in the body.

export const LABEL = 'i18n: missing translations';

const marker = (body) => /<!-- i18n-missing:([\w-]+) -->/.exec(body ?? '')?.[1];
const hashOf = (body) => /<!-- i18n-hash:(\w+) -->/.exec(body ?? '')?.[1];

/**
 * @param {{ github: any, context: any, core: any, report: Array<{ code: string, name: string, count: number, hash: string, title: string, body: string }>, dryRun?: boolean, sha?: string }} o
 * @returns {Promise<Array<{ lang: string, action: string, number?: number }>>}
 */
export async function syncIssues({ github, context, core, report, dryRun = false, sha = '' }) {
  const { owner, repo } = context.repo;
  const log = [];
  const act = async (lang, action, number, fn) => {
    log.push({ lang, action, number });
    core.info(`${lang}: ${action}${number ? ` #${number}` : ''}${dryRun ? ' (dry run)' : ''}`);
    if (!dryRun) await fn();
  };

  if (!dryRun)
    try {
      await github.rest.issues.createLabel({ owner, repo, name: LABEL, color: 'c5def5', description: 'Opened and closed by the Missing translations workflow' });
    } catch (e) {
      if (e.status !== 422) throw e; // 422 = label exists already
    }

  const open = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', labels: LABEL, per_page: 100 });
  const byLang = new Map();
  for (const issue of open) {
    if (issue.pull_request) continue;
    const lang = marker(issue.body);
    if (!lang) continue;
    if (byLang.has(lang)) {
      // Duplicate (e.g. two runs at once): keep the oldest one
      const keep = byLang.get(lang).number < issue.number ? byLang.get(lang) : issue;
      const drop = keep === issue ? byLang.get(lang) : issue;
      await act(lang, 'close duplicate', drop.number, async () => {
        await github.rest.issues.createComment({ owner, repo, issue_number: drop.number, body: `Duplicate of #${keep.number}.` });
        await github.rest.issues.update({ owner, repo, issue_number: drop.number, state: 'closed', state_reason: 'not_planned' });
      });
      byLang.set(lang, keep);
    } else byLang.set(lang, issue);
  }

  const known = new Set(report.map((l) => l.code));
  for (const lang of report) {
    const issue = byLang.get(lang.code);
    if (lang.count === 0) {
      if (issue)
        await act(lang.code, 'close', issue.number, async () => {
          await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body: `Everything in ${lang.name} is translated now${sha ? ` (as of ${sha})` : ''}. Closing.` });
          await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: 'closed', state_reason: 'completed' });
        });
      continue;
    }
    if (!issue) {
      await act(lang.code, 'open', undefined, async () => {
        const { data } = await github.rest.issues.create({ owner, repo, title: lang.title, body: lang.body, labels: [LABEL] });
        log[log.length - 1].number = data.number;
      });
    } else if (hashOf(issue.body) !== lang.hash || issue.title !== lang.title) {
      await act(lang.code, 'update', issue.number, () => github.rest.issues.update({ owner, repo, issue_number: issue.number, title: lang.title, body: lang.body }));
    } else log.push({ lang: lang.code, action: 'unchanged', number: issue.number });
  }

  // A language whose files were removed has nothing left to translate
  for (const [lang, issue] of byLang)
    if (!known.has(lang))
      await act(lang, 'close (language removed)', issue.number, async () => {
        await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body: 'This language has no translation files any more. Closing.' });
        await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: 'closed', state_reason: 'not_planned' });
      });

  return log;
}
