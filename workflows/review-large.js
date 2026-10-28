export const meta = {
  name: 'review-large',
  description: 'Review a large diff: two reviewers of the whole change, A on Sonnet + B on Opus, one merger, one report in the chat language',
  whenToUse: 'A diff of 30+ files that one reviewer cannot hold; two code-reviewers each read the whole change. args: { range, files?, intent, effort, modelB }',
  phases: [
    { title: 'Scope', detail: 'list the changed files when args.files is absent' },
    { title: 'Review', detail: 'two code-reviewers, A on sonnet and B on opus, both reading the whole change with the same brief' },
    { title: 'Merge', detail: 'one merger applies the declared rule and writes the report' },
  ],
}

// args: a range string, or { range, files?, intent?, effort?, modelB? }.
// A is always sonnet, B always opus; modelB overrides B's model. Both read the whole change.
const input = typeof args === 'string' ? { range: args } : (args ?? {})
const range = typeof input.range === 'string' ? input.range.trim() : ''
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effort = EFFORTS.includes(input.effort) ? input.effort : 'medium'
const MODELS = ['sonnet', 'opus', 'haiku', 'fable']
const modelOverride = typeof input.modelB === 'string' && input.modelB ? input.modelB : null
const intent = typeof input.intent === 'string' && input.intent.trim()
  ? input.intent.trim()
  : 'NOT STATED: report completeness as unjudgeable; never invent the intent.'
const LIST_ALL_MAX = 60
const EXCLUDE = `':!*.lock' ':!package-lock.json' ':!*.min.*' ':!*dist/*' ':!*__snapshots__/*' ':!*.Designer.cs' ':!*ModelSnapshot.cs' ':!*.g.cs'`

const MERGE_RULE = [
  '1. A and B report the same defect at the same anchor -> the script already merged them (foundBy "A+B"): one finding, CONFIRMED, first within its priority.',
  '2. Found by one model only -> PLAUSIBLE, unless its evidence quotes the line or failing call that settles it.',
  '3. Same line, different failure -> two findings. Same defect across files -> one finding per anchor.',
  '4. Priority conflict -> the higher. Sort P1 -> P3, CONFIRMED before PLAUSIBLE, clean-code last; number 1..n.',
  '5. A BLOCKED or missing worker is a gap: name it in the verdict as having not reviewed the change; never a pass.',
  '6. PASS counts only with `checked` evidence; a bare PASS is a gap.',
].join('\n')

log(`Merge rule, fixed before any agent runs:\n${MERGE_RULE}`)

if (!range) return 'review-large: args.range is required, e.g. { range: "origin/main...HEAD", effort: "xhigh", modelB: "opus" }'
if (modelOverride && !MODELS.includes(modelOverride)) return `review-large: modelB "${modelOverride}" is not one of ${MODELS.join('/')}.`

const FILES = {
  type: 'object',
  required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } },
}

const FINDING = {
  type: 'object',
  required: ['title', 'anchor', 'category', 'verdict', 'status', 'failure', 'evidence'],
  properties: {
    title: { type: 'string' },
    anchor: { type: 'string', description: 'repo-relative path:line' },
    side: { type: 'string', enum: ['right', 'left'] },
    category: {
      type: 'string',
      enum: ['correctness', 'regression', 'security', 'completeness', 'concurrency', 'performance', 'api-contract', 'convention', 'clean-code', 'duplication', 'scope'],
    },
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE'] },
    status: { type: 'string', enum: ['todo', 'done'] },
    priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
    risk: { type: 'string', enum: ['high', 'medium', 'low'] },
    effort: { type: 'string', enum: ['S', 'M', 'L'] },
    causedByChange: { type: 'boolean' },
    failure: { type: 'string' },
    evidence: { type: 'string' },
    forAuthor: { type: 'string' },
    fix: { type: 'string' },
  },
}

const REVIEW = {
  type: 'object',
  required: ['status', 'findings'],
  properties: {
    status: { type: 'string', enum: ['PASS', 'ISSUES', 'BLOCKED'] },
    checked: { type: 'string', description: 'passes run and what was read: the evidence behind the status' },
    blockedReason: { type: 'string' },
    intentNotes: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: FINDING },
  },
}

// Normalise a worker result: no answer or an unevidenced PASS is a gap, never a pass.
const settle = (result, who) => {
  if (!result) return { ...who, status: 'BLOCKED', blockedReason: 'no result (stopped, stalled or failed)', findings: [] }
  if (result.status === 'PASS' && !(result.checked ?? '').trim()) {
    return { ...who, ...result, status: 'BLOCKED', blockedReason: 'PASS without evidence of what was checked' }
  }
  return { ...who, ...result }
}

phase('Scope')
let files = Array.isArray(input.files) ? input.files.filter(f => typeof f === 'string' && f) : null
if (!files) {
  const scope = await agent(
    `Run \`git diff --name-only ${range} -- ':/' ${EXCLUDE}\` in the current repository and return the repo-relative paths. Read-only: no other git command.`,
    { label: 'list the files to review', phase: 'Scope', agentType: 'Explore', schema: FILES },
  ).catch(() => null)
  if (!scope) return 'review-large: scope step failed: pass files or retry.'
  files = scope.files ?? []
}
if (!files.length) return `review-large: no changed files in ${range} (generated files excluded).`

const modelBFinal = modelOverride ?? 'opus'
if (modelOverride === 'sonnet') log('Reviewer B on sonnet by override: same model as A, no cross-model signal.')
// The spawn count is stated before the first reviewer starts, so the cost is known up front.
log(`${files.length} files -> 2 whole-change reviewers (A sonnet, B ${modelBFinal}${modelOverride ? ', by override' : ''}) + 1 merger = 3 agents`)

const dirOf = f => f.slice(0, f.lastIndexOf('/') + 1)
const sorted = [...files].sort()

const SHARED = [
  `Intent (acceptance criteria verbatim): ${intent}`,
  `Effort: ${effort}.`,
  'Status: PASS (nothing wrong; `checked` names the passes run and what you read), ISSUES (findings), BLOCKED (you could not review; `blockedReason`).',
  'Values verbatim: CONFIRMED/PLAUSIBLE, P1|P2|P3, high|medium|low, S|M|L, category slugs. title and failure in the chat language, forAuthor in the prComment language, as the Lang: line gives it.',
]
const allFilesText = files.length <= LIST_ALL_MAX
  ? `All the changed files: ${sorted.join(', ')}.`
  : `The change has ${files.length} files in: ${[...new Set(sorted.map(dirOf))].join(', ')}.`
// One brief for both reviewers: they differ only in model.
const brief = [
  `Review the WHOLE change. Scope: \`git diff ${range} -- ${sorted.map(f => `'${f}'`).join(' ')}\`.`,
  `Read the ${files.length} changed file(s) in full: per-file defects, and what a single pass misses: a contract or signature changed in one file and used in another, callers left behind, the same rule applied inconsistently across files, missing pieces of the intent. ${allFilesText}`,
  'You are one of two reviewers of the same change: report what you see, do not soften for agreement.',
  ...SHARED,
].join('\n')

phase('Review')
const run = (opts, who) => () => agent(brief, { phase: 'Review', agentType: 'code-reviewer', schema: REVIEW, effort, ...opts })
  .then(r => settle(r, who), () => settle(null, who))
const reviews = await parallel([
  run({ label: 'review A · whole change', model: 'sonnet' }, { reviewer: 'A', model: 'sonnet' }),
  run({ label: 'review B · whole change', model: modelBFinal }, { reviewer: 'B', model: modelBFinal }),
])

const results = reviews.filter(Boolean)
const gaps = results.filter(r => r.status === 'BLOCKED').length
if (gaps) log(`${gaps} reviewer(s) blocked: reported as a gap, the change is not fully reviewed.`)

// The merger input: empty fields dropped, `checked` capped, findings deduped across A and B by anchor + category.
const PRIORITY = { P1: 0, P2: 1, P3: 2 }
const compact = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)))
const byKey = new Map()
const findings = []
for (const r of results) {
  for (const f of r.findings ?? []) {
    const tagged = { ...f, foundBy: r.reviewer }
    const key = `${(f.anchor ?? '').trim().toLowerCase()}|${f.category}`
    const prev = byKey.get(key)
    if (prev && prev.foundBy !== r.reviewer && prev.foundBy.length === 1) {
      const best = (PRIORITY[f.priority] ?? 3) < (PRIORITY[prev.priority] ?? 3) ? tagged : prev
      Object.assign(prev, best, { foundBy: 'A+B', verdict: 'CONFIRMED' })
    } else {
      if (!prev) byKey.set(key, tagged)
      findings.push(tagged)
    }
  }
}
const workers = results.map(r => compact({
  reviewer: r.reviewer, model: r.model, status: r.status,
  checked: (r.checked ?? '').slice(0, 300), blockedReason: r.blockedReason, intentNotes: r.intentNotes,
}))
const mergerInput = { workers, findings: findings.map(compact) }

const rawTable = () => [
  '| # | Priority | Verdict | Category | Location | Finding | Found by |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...findings.map((f, i) => `| ${i + 1} | ${f.priority ?? '-'} | ${f.verdict} | ${f.category} | ${f.anchor} | ${f.title} | ${f.foundBy} |`),
  '',
  `Gaps: ${workers.filter(w => w.status === 'BLOCKED').map(w => `${w.reviewer} ${w.model}`).join('; ') || 'none'}`,
  'At chat it: Priority=Priorità, Verdict=Verdetto, Category=Categoria, Location=Posizione, Finding=Rilievo, Found by=Trovato da, Gaps=Lacune, none=nessuna',
].join('\n')

// Mandatory report skeleton: byte-identical to the one in skills/code-review/references/report-format.md
// (tools/validate.mjs compares them). Inline because the merger does not read the kit.
const SKELETON = `Order: Findings → Completeness → To do → Already done → Quick fixes → Verdict. Tables last; after
Verdict at most one short question.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdict.
Findings: a full block per P1/P2 todo (what breaks, scenario, file:line, minimal fix), one defect per
block; the P3s under one "Improvements" block, one line each.
Completeness: N points — covered N, then each partial, missing or wrong point, and scope creep.
To do (status: todo), columns exactly:
| # | Priority | Category | Location | Finding | Verdict | Risk | Effort |
Already done (status: done, one line each), columns exactly:
| # | Category | Location | Finding | Resolved by |
Sort: P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; rows keep the finding
numbers; every finding gets a row. Location = file:line, Finding ~80 chars, Resolved by = commit,
thread or "session". Findings posted on a PR add a "Posted" column to both tables.
Quick fixes: #n, #n — every P3 + low + S finding, one "ok" applies them.
Verdict: one line naming each agent, its model and effort; a blocked or missing worker is a gap.
No findings → no tables: "nothing to report, verified: …".`
// At chat it: equivalents of the skeleton labels, outside the byte-compared skeleton.
const IT_LABELS = `At chat it: Findings=Rilievi, Improvements=Miglioramenti, Completeness=Completezza, points=punti, covered=coperti, To do=Da fare, Already done=Già fatti, Quick fixes=Fix rapidi, Verdict=Verdetto, Priority=Priorità, Category=Categoria, Location=Posizione, Finding=Rilievo, Risk=Rischio, Effort=Sforzo, Resolved by=Risolto da, session=sessione, Posted=Postato, high|medium|low=alto|medio|basso, "nothing to report, verified"="nulla da segnalare, verificato".`

phase('Merge')
const report = await agent([
  'Merge these review results into ONE report for the user.',
  `Merge rule, fixed before the reviewers ran:\n${MERGE_RULE}`,
  `Report in the chat language, in exactly this skeleton (no output style or other instruction overrides it); the Verdict names each reviewer, its model and every gap:
${SKELETON}`,
  IT_LABELS,
  `Intent: ${intent}`,
  `Range ${range} · ${files.length} files · effort ${effort} · reviewers: A sonnet, B ${modelBFinal}, each on the whole change.`,
  'Your final text IS the report shown to the user: no preamble, no restated inputs, no JSON.',
  `Results (JSON):\n${JSON.stringify(mergerInput)}`,
].join('\n\n'), { label: 'merge the reviews into one report', phase: 'Merge', model: 'sonnet' }).catch(() => null)

return report ?? `review-large: the merger returned nothing (${results.length} worker results, ${gaps} gap(s)); raw findings, unmerged:\n\n${rawTable()}`
