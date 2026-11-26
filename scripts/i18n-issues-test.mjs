// Tests for scripts/i18n-issues.mjs with a fake GitHub API: open, update, keep, close, duplicates.
// Run: npm run test:i18n-issues
import assert from 'node:assert/strict';
import { syncIssues, LABEL } from './i18n-issues.mjs';

function fakeGitHub(issues) {
  const calls = [];
  let next = 100;
  const rest = {
    issues: {
      createLabel: async () => {
        calls.push(['label']);
        throw Object.assign(new Error('exists'), { status: 422 });
      },
      listForRepo: async () => ({ data: issues.filter((i) => i.state === 'open') }),
      create: async (a) => {
        calls.push(['create', a.title]);
        const issue = { number: next++, state: 'open', title: a.title, body: a.body, labels: a.labels };
        issues.push(issue);
        return { data: issue };
      },
      update: async (a) => {
        calls.push(['update', a.issue_number, a.state ?? 'body']);
        Object.assign(issues.find((i) => i.number === a.issue_number), a.state ? { state: a.state } : { body: a.body, title: a.title });
      },
      createComment: async (a) => calls.push(['comment', a.issue_number]),
    },
  };
  return { calls, github: { rest, paginate: async (fn, args) => (await fn(args)).data } };
}
const context = { repo: { owner: 'o', repo: 'r' } };
const core = { info: () => {} };
const lang = (code, count, hash = 'h1') => ({ code, name: code.toUpperCase(), count, hash, title: `Missing translations: ${code.toUpperCase()} (${code})`, body: `<!-- i18n-missing:${code} -->\n<!-- i18n-hash:${hash} -->\nlist` });
const issue = (number, code, hash = 'h1') => ({ number, state: 'open', title: `Missing translations: ${code.toUpperCase()} (${code})`, body: `<!-- i18n-missing:${code} -->\n<!-- i18n-hash:${hash} -->` });

// Opens a new issue only where something is missing
{
  const issues = [];
  const { github, calls } = fakeGitHub(issues);
  const log = await syncIssues({ github, context, core, report: [lang('fr', 62), lang('it', 0)] });
  assert.deepEqual(log, [{ lang: 'fr', action: 'open', number: 100 }]);
  assert.deepEqual(calls.filter((c) => c[0] === 'create'), [['create', 'Missing translations: FR (fr)']]);
}
// Same findings: nothing changes; new findings: body updated
{
  const issues = [issue(5, 'fr', 'h1'), issue(6, 'it', 'old')];
  const { github, calls } = fakeGitHub(issues);
  const log = await syncIssues({ github, context, core, report: [lang('fr', 3, 'h1'), lang('it', 4, 'h2')] });
  assert.deepEqual(log.map((l) => l.action), ['unchanged', 'update']);
  assert.deepEqual(calls.filter((c) => c[0] === 'update'), [['update', 6, 'body']]);
  assert.match(issues[1].body, /i18n-hash:h2/);
}
// Everything translated: comment and close; removed language: close as not planned
{
  const issues = [issue(5, 'fr'), issue(7, 'xx')];
  const { github, calls } = fakeGitHub(issues);
  const log = await syncIssues({ github, context, core, report: [lang('fr', 0)], sha: 'abc1234' });
  assert.deepEqual(log.map((l) => [l.lang, l.action]), [['fr', 'close'], ['xx', 'close (language removed)']]);
  assert.equal(issues.filter((i) => i.state === 'open').length, 0);
  assert.equal(calls.filter((c) => c[0] === 'comment').length, 2);
}
// Two open issues for one language: the newer one is closed as duplicate
{
  const issues = [issue(9, 'fr'), issue(4, 'fr')];
  const { github } = fakeGitHub(issues);
  const log = await syncIssues({ github, context, core, report: [lang('fr', 2)] });
  assert.deepEqual(log, [{ lang: 'fr', action: 'close duplicate', number: 9 }, { lang: 'fr', action: 'unchanged', number: 4 }]);
}
// Issues without the marker are left alone; dry run changes nothing
{
  const issues = [{ number: 3, state: 'open', title: 'Other', body: 'hand written' }];
  const { github, calls } = fakeGitHub(issues);
  const log = await syncIssues({ github, context, core, report: [lang('fr', 2)], dryRun: true });
  assert.deepEqual(log, [{ lang: 'fr', action: 'open', number: undefined }]);
  assert.equal(calls.length, 0);
}
assert.equal(LABEL, 'i18n: missing translations');

// The report itself: every language has a title, a marker and a body below GitHub's limit
const { report } = await import('./i18n-report.mjs');
for (const l of report()) {
  assert.match(l.body, new RegExp(`^<!-- i18n-missing:${l.code} -->`));
  assert.ok(l.body.length < 65536, `${l.code} body too long`);
  assert.equal(l.count, l.areas.reduce((n, a) => n + a.missing + a.wrong, 0));
}
console.log('i18n issues: all tests passed');
