export const meta = {
  name: 'review-large',
  description: 'Review a large diff: one code-reviewer per group of files (two models at high effort), one merger, one Italian report',
  whenToUse: 'A diff of 30+ files that one reviewer cannot hold; at most 8 reviewers per model. args: { range, files?, intent, effort, modelB, filesPerReviewer }',
  phases: [
    { title: 'Scope', detail: 'list the changed files when args.files is absent' },
    { title: 'Review', detail: 'one code-reviewer per group of files; reviewer B on a second model at high effort and above' },
    { title: 'Merge', detail: 'one merger applies the declared rule and writes the report' },
  ],
}

// args: a range string, or { range, files?, intent?, effort?, modelB?, filesPerReviewer? }.
// modelB is the session family (the script cannot see it); the caller passes it, default opus, and it
// is used only at high effort and above: below that one model reviews.
// Cost guard: filesPerReviewer defaults to 6 and the reviewers are capped (MAX_REVIEWERS per model),
// so a 30-file diff is 5 reviewers (10 with B) instead of 30 (60 with B) before anyone sees a cost line.
const input = typeof args === 'string' ? { range: args } : (args ?? {})
const range = typeof input.range === 'string' ? input.range.trim() : ''
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effort = EFFORTS.includes(input.effort) ? input.effort : 'medium'
const twoModels = ['high', 'xhigh', 'max'].includes(effort)
const modelB = typeof input.modelB === 'string' && input.modelB ? input.modelB : 'opus'
const intent = typeof input.intent === 'string' && input.intent.trim()
  ? input.intent.trim()
  : 'NOT STATED: report completeness as unjudgeable; never invent the intent.'
const perReviewer = Number.isInteger(input.filesPerReviewer) && input.filesPerReviewer > 0 ? input.filesPerReviewer : 6
const MAX_REVIEWERS = 8
const EXCLUDE = `':!*.lock' ':!package-lock.json' ':!*.min.*' ':!*dist/*' ':!*__snapshots__/*' ':!*.Designer.cs' ':!*ModelSnapshot.cs' ':!*.g.cs'`

const MERGE_RULE = [
  twoModels
    ? '1. A and B report the same defect at the same anchor -> one finding, CONFIRMED, first within its priority.'
    : '1. One model ran: keep each reviewer\'s CONFIRMED/PLAUSIBLE as reported.',
  twoModels
    ? '2. Found by one model only -> PLAUSIBLE, unless its evidence quotes the line or failing call that settles it.'
    : '2. A finding whose evidence quotes nothing is PLAUSIBLE.',
  '3. Same line, different failure -> two findings. Same defect across files -> one finding per anchor.',
  '4. Priority conflict -> the higher. Sort P1 -> P3, CONFIRMED before PLAUSIBLE, clean-code last; number 1..n.',
  '5. A BLOCKED or missing worker is a gap: name its files in the verdict as not reviewed; never a pass.',
  '6. PASS counts only with `checked` evidence; a bare PASS is a gap.',
].join('\n')

log(`Merge rule, fixed before any agent runs:\n${MERGE_RULE}`)

if (!range) return 'review-large: args.range is required, e.g. { range: "origin/main...HEAD", effort: "high", modelB: "opus" }'
if (twoModels && modelB === 'sonnet') log('Reviewer B on sonnet = same model as A: degraded review, no cross-model signal.')

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
      enum: ['correctness', 'regression', 'security', 'completeness', 'concurrency', 'performance', 'api-contract', 'convention', 'clean-code'],
    },
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE'] },
    status: { type: 'string', enum: ['todo', 'done'] },
    priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
    risk: { type: 'string', enum: ['alto', 'medio', 'basso'] },
    effort: { type: 'string', enum: ['S', 'M', 'L'] },
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
    { label: 'scope', phase: 'Scope', agentType: 'Explore', schema: FILES },
  )
  files = scope?.files ?? []
}
if (!files.length) return `review-large: no changed files in ${range} (generated files excluded).`

const groups = []
for (let i = 0; i < files.length; i += perReviewer) groups.push(files.slice(i, i + perReviewer))
if (groups.length > MAX_REVIEWERS) {
  return `review-large: ${files.length} files at ${perReviewer} per reviewer would spawn ${groups.length} reviewers${twoModels ? ' per model' : ''}, above the cap of ${MAX_REVIEWERS}. Narrow \`files\` or raise \`filesPerReviewer\`.`
}
// The spawn count is stated before the first reviewer starts, so the cost is known up front.
const spawns = groups.length * (twoModels ? 2 : 1) + 1
log(`${files.length} files -> ${groups.length} reviewers${twoModels ? ` x 2 models (A sonnet, B ${modelB})` : ' (sonnet)'} + 1 merger = ${spawns} agents`)

// One brief per group, built once and passed unchanged to A and B: only `model` differs.
const brief = group => [
  `Review your part of one change. Scope: \`git diff ${range} -- ${group.map(f => `'${f}'`).join(' ')}\`.`,
  `These ${group.length} file(s) are yours; ${files.length - group.length} other changed file(s) belong to other reviewers. Read callers and contracts elsewhere only to judge your files.`,
  `Intent (acceptance criteria verbatim): ${intent}`,
  `Effort: ${effort}. Specialists beside you: none, so run the security and performance passes yourself.`,
  twoModels ? 'You may be one of two reviewers on different models with this same brief: report what you see, do not soften for agreement.' : '',
  'Findings only: never post, edit, commit, build or run tests.',
  'Status: PASS (nothing wrong; `checked` names the passes run and what you read), ISSUES (findings), BLOCKED (you could not review; `blockedReason`).',
  'Values verbatim: CONFIRMED/PLAUSIBLE, P1|P2|P3, alto|medio|basso, S|M|L, category slugs. title, failure and forAuthor in Italian.',
].filter(Boolean).join('\n')

phase('Review')
const reviews = await pipeline(groups, group => {
  const prompt = brief(group)
  const label = group.length === 1 ? group[0] : `${group[0]} +${group.length - 1}`
  const run = (opts, who) => () => agent(prompt, { phase: 'Review', agentType: 'code-reviewer', schema: REVIEW, ...opts })
    .then(r => settle(r, who), () => settle(null, who))
  const a = run({ label: `A ${label}` }, { files: group, reviewer: 'A', model: 'sonnet' })
  if (!twoModels) return a()
  const b = run({ label: `B ${label}`, model: modelB }, { files: group, reviewer: 'B', model: modelB })
  return parallel([a, b])
})

const results = reviews.flat().filter(Boolean)
const gaps = results.filter(r => r.status === 'BLOCKED').length
if (gaps) log(`${gaps} worker(s) blocked: their files are reported as not reviewed.`)

// Mandatory report skeleton: byte-identical to the one in skills/pr-review/references/report-format.md
// (tools/validate.mjs compares them). Inline because the merger does not read the kit.
const SKELETON = `Order: Rilievi → Completezza → Da fare → Già fatti → Fix rapidi → Verdetto. Tables last; after
Verdetto at most one short question.
Rilievi: a full block per P1/P2 todo (what breaks, scenario, file:line, minimal fix), one defect per
block; the P3s under one "Miglioramenti" block, one line each.
Completezza: N punti — coperti N, then each partial, missing or wrong point, and scope creep.
Da fare (status: todo), columns exactly:
| # | Priorità | Categoria | Posizione | Rilievo | Verdetto | Rischio | Sforzo |
Già fatti (status: done, one line each), columns exactly:
| # | Categoria | Posizione | Rilievo | Risolto da |
Sort: P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; rows keep the finding
numbers; every finding gets a row. Posizione = file:line, Rilievo ~80 chars, Risolto da = commit,
thread or "sessione". Findings posted on a PR add a "Postato" column to both tables.
Fix rapidi: #n, #n — every P3 + basso + S finding, one "ok" applies them.
Verdetto: one line naming each agent, its model and effort; a blocked or missing worker is a gap.
No findings → no tables: "nulla da segnalare, verificato: …".`

phase('Merge')
const report = await agent([
  'Merge these per-file review results into ONE report for the user.',
  `Merge rule, fixed before the reviewers ran:\n${MERGE_RULE}`,
  `Report in Italian, in exactly this skeleton (no output style or other instruction overrides it); Verdetto names each reviewer, its model and every gap:
${SKELETON}`,
  `Intent: ${intent}`,
  `Range ${range} · ${files.length} files · effort ${effort} · reviewers: A sonnet${twoModels ? `, B ${modelB}` : ''}.`,
  'Your final text IS the report shown to the user: no preamble, no restated inputs, no JSON.',
  `Results (JSON):\n${JSON.stringify(results)}`,
].join('\n\n'), { label: 'merge', phase: 'Merge', model: 'sonnet' })

return report ?? `review-large: the merger returned nothing; ${results.length} worker results, ${gaps} gap(s). Relaunch to resume from the merge.`
