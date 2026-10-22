export const meta = {
  name: 'audit-repos',
  description: 'Ask every repository under a workspace root the same read-only question, then rank the answers',
  whenToUse: 'One question across many repos: a dependency, a pattern, a secret, a config key. args: { question, root?, repos? }',
  phases: [
    { title: 'Discover', detail: 'list the git repositories under the root when args.repos is absent' },
    { title: 'Audit', detail: 'one read-only agent per repository, same question' },
    { title: 'Rank', detail: 'the declared rule ranks the answers; gaps are listed, never counted as clean' },
  ],
}

// args: a question string, or { question, root?, repos?: [absolute paths], effort? }.
const input = typeof args === 'string' ? { question: args } : (args ?? {})
const question = typeof input.question === 'string' ? input.question.trim() : ''
const root = typeof input.root === 'string' && input.root.trim() ? input.root.trim() : 'the current working directory'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effort = EFFORTS.includes(input.effort) ? input.effort : 'medium'
const MAX_HITS = 10

const RULE = [
  '1. Every repository gets the same question, verbatim, read-only.',
  '2. A hit counts only with file:line evidence; a hit without it is dropped and counted.',
  '3. PASS counts only with `checked` (what was searched, how); a bare PASS is a gap.',
  '4. BLOCKED or no answer is a gap, listed by name; never reported as clean.',
  '5. Rank by P1 count, then P2, then total hits; ties by repository name.',
].join('\n')

log(`Selection and ranking rule, fixed before any agent runs:\n${RULE}`)

if (!question) return 'audit-repos: args.question is required, e.g. { question: "Which repos still reference package X below 2.0?", root: "<workspace root>" }'

const REPOS = {
  type: 'object',
  required: ['repos'],
  properties: { repos: { type: 'array', items: { type: 'string' } } },
}

const AUDIT = {
  type: 'object',
  required: ['status', 'hits'],
  properties: {
    status: { type: 'string', enum: ['PASS', 'ISSUES', 'BLOCKED'] },
    checked: { type: 'string', description: 'what was searched and how: the evidence behind the status' },
    blockedReason: { type: 'string' },
    hits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['location', 'what', 'priority', 'evidence'],
        properties: {
          location: { type: 'string', description: 'repo-relative path:line' },
          what: { type: 'string' },
          priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          evidence: { type: 'string', description: 'the quoted line or command output' },
        },
      },
    },
  },
}

phase('Discover')
let repos = Array.isArray(input.repos) ? input.repos.filter(r => typeof r === 'string' && r) : null
if (!repos) {
  const found = await agent(
    `List every git repository under ${root}: a directory that contains a .git entry, at most two levels deep. Return absolute paths. Read-only.`,
    { label: 'discover', phase: 'Discover', agentType: 'Explore', schema: REPOS },
  )
  repos = found?.repos ?? []
}
if (!repos.length) return `audit-repos: no git repository found under ${root}.`
log(`${repos.length} repositories -> ${repos.length} auditor(s), no merger agent: the rule ranks in the script`)

const prompt = repo => [
  `Repository: ${repo}. Work only inside it, read-only: Read, Grep, Glob, and git log/show/grep. Never edit, build, install or fetch.`,
  `Question: ${question}`,
  `Effort: ${effort}.`,
  'Status: ISSUES (hits, each with repo-relative path:line and the quoted evidence), PASS (nothing found; `checked` names what you searched and how), BLOCKED (you could not answer; `blockedReason`).',
  'priority: P1 blocks or exposes something now, P2 fix before the next release, P3 improvement. `what` in Italian.',
].join('\n')

const settle = (result, repo) => {
  if (!result) return { repo, status: 'BLOCKED', blockedReason: 'no result (stopped, stalled or failed)', hits: [], dropped: 0 }
  const hits = (result.hits ?? []).filter(h => h && h.location && h.evidence)
  const dropped = (result.hits ?? []).length - hits.length
  if (result.status === 'PASS' && !(result.checked ?? '').trim()) {
    return { repo, ...result, hits, dropped, status: 'BLOCKED', blockedReason: 'PASS without evidence of what was searched' }
  }
  return { repo, ...result, hits, dropped }
}

phase('Audit')
const answers = await pipeline(repos, repo => agent(prompt(repo), {
  label: repo.split(/[\\/]/).filter(Boolean).pop() ?? repo,
  phase: 'Audit',
  agentType: 'Explore',
  model: 'haiku',
  effort,
  schema: AUDIT,
}).then(r => settle(r, repo), () => settle(null, repo)))

phase('Rank')
const all = answers.map((a, i) => a ?? settle(null, repos[i]))
const count = (a, p) => a.hits.filter(h => h.priority === p).length
const name = a => a.repo.split(/[\\/]/).filter(Boolean).pop() ?? a.repo
const withHits = all.filter(a => a.status !== 'BLOCKED' && a.hits.length)
  .sort((x, y) => count(y, 'P1') - count(x, 'P1') || count(y, 'P2') - count(x, 'P2')
    || y.hits.length - x.hits.length || name(x).localeCompare(name(y)))
const clean = all.filter(a => a.status === 'PASS' && !a.hits.length)
const gaps = all.filter(a => a.status === 'BLOCKED' || (a.status === 'ISSUES' && !a.hits.length))
  .map(a => a.status === 'BLOCKED' ? a : { ...a, blockedReason: 'ISSUES without file:line evidence' })
const dropped = all.reduce((n, a) => n + (a.dropped ?? 0), 0)
const order = { P1: 0, P2: 1, P3: 2 }

const lines = [`## Audit: ${question}`, '']
if (withHits.length) {
  lines.push('| # | Repo | P1 | P2 | P3 | Rilievi |', '| --- | --- | --- | --- | --- | --- |')
  withHits.forEach((a, i) => lines.push(`| ${i + 1} | ${name(a)} | ${count(a, 'P1')} | ${count(a, 'P2')} | ${count(a, 'P3')} | ${a.hits.length} |`))
  for (const a of withHits) {
    lines.push('', `### ${name(a)}`)
    const top = [...a.hits].sort((x, y) => order[x.priority] - order[y.priority]).slice(0, MAX_HITS)
    top.forEach(h => lines.push(`- ${h.priority} \`${h.location}\` — ${h.what}`))
    if (a.hits.length > MAX_HITS) lines.push(`- … altri ${a.hits.length - MAX_HITS}`)
  }
} else {
  lines.push('Nessun rilievo con evidenza.')
}
lines.push('', `**Verificati senza rilievi** (${clean.length}): ${clean.map(name).join(', ') || '—'}`)
lines.push(`**Lacune, non verificati** (${gaps.length}): ${gaps.map(a => `${name(a)} (${a.blockedReason})`).join('; ') || '—'}`)
if (dropped) lines.push(`Scartati ${dropped} rilievi senza evidenza file:line.`)

return lines.join('\n')
