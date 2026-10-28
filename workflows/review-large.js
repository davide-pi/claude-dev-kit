export const meta = {
  name: 'review-large',
  description: 'Review a large diff: at most 3 cohesive groups of files plus one reviewer of the whole change on a second model, one merger, one Italian report',
  whenToUse: 'A diff of 30+ files that one reviewer cannot hold; at most 3 group reviewers plus one whole-change reviewer. args: { range, files?, intent, effort, modelB, filesPerReviewer }',
  phases: [
    { title: 'Scope', detail: 'list the changed files when args.files is absent' },
    { title: 'Review', detail: 'at most 3 code-reviewers, one per cohesive group of files; reviewer B on a second model reads the whole change for what a group cannot see' },
    { title: 'Merge', detail: 'one merger applies the declared rule and writes the report' },
  ],
}

// args: a range string, or { range, files?, intent?, effort?, modelB?, filesPerReviewer? }.
// modelB is the model of reviewer B, the one reviewer of the whole change, default opus; it always runs.
// Cost guard: filesPerReviewer defaults to 10 and the groups are capped (MAX_GROUPS), so any diff is at most
// 3 group reviewers + 1 whole-change reviewer: the files per group grow past filesPerReviewer instead of adding reviewers.
const input = typeof args === 'string' ? { range: args } : (args ?? {})
const range = typeof input.range === 'string' ? input.range.trim() : ''
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effort = EFFORTS.includes(input.effort) ? input.effort : 'medium'
const MODELS = ['sonnet', 'opus', 'haiku', 'fable']
const modelB = typeof input.modelB === 'string' && input.modelB ? input.modelB : 'opus'
const intent = typeof input.intent === 'string' && input.intent.trim()
  ? input.intent.trim()
  : 'NOT STATED: report completeness as unjudgeable; never invent the intent.'
const perReviewer = Number.isInteger(input.filesPerReviewer) && input.filesPerReviewer > 0 ? input.filesPerReviewer : 10
const MAX_GROUPS = 3
const LIST_ALL_MAX = 60
const EXCLUDE = `':!*.lock' ':!package-lock.json' ':!*.min.*' ':!*dist/*' ':!*__snapshots__/*' ':!*.Designer.cs' ':!*ModelSnapshot.cs' ':!*.g.cs'`

const MERGE_RULE = [
  '1. A and B report the same defect at the same anchor -> the script already merged them (foundBy "A+B"): one finding, CONFIRMED, first within its priority.',
  '2. Found by one model only -> PLAUSIBLE, unless its evidence quotes the line or failing call that settles it.',
  '3. Same line, different failure -> two findings. Same defect across files -> one finding per anchor.',
  '4. Priority conflict -> the higher. Sort P1 -> P3, CONFIRMED before PLAUSIBLE, clean-code last; number 1..n.',
  '5. A BLOCKED or missing worker is a gap: name its files in the verdict as not reviewed; never a pass.',
  '6. PASS counts only with `checked` evidence; a bare PASS is a gap.',
].join('\n')

log(`Merge rule, fixed before any agent runs:\n${MERGE_RULE}`)

if (!range) return 'review-large: args.range is required, e.g. { range: "origin/main...HEAD", effort: "xhigh", modelB: "opus" }'
if (!MODELS.includes(modelB)) return `review-large: modelB "${modelB}" is not one of ${MODELS.join('/')}.`
if (modelB === 'sonnet') log('Reviewer B on sonnet = same model as A: degraded review, no cross-model signal.')

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
    risk: { type: 'string', enum: ['alto', 'medio', 'basso'] },
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

// Cohesive groups: the path-sorted list (directory first) cut into contiguous, balanced chunks; each cut snaps to the
// nearest directory boundary within half a chunk of the balanced cut, so a directory stays in one group where it can.
const dirOf = f => f.slice(0, f.lastIndexOf('/') + 1)
const sorted = [...files].sort((x, y) => (dirOf(x) < dirOf(y) ? -1 : dirOf(x) > dirOf(y) ? 1 : x < y ? -1 : x > y ? 1 : 0))
const groupCount = Math.min(MAX_GROUPS, Math.ceil(sorted.length / perReviewer))
const snapWindow = Math.ceil(sorted.length / groupCount / 2)
const boundaries = sorted.map((f, i) => i).filter(i => i > 0 && dirOf(sorted[i - 1]) !== dirOf(sorted[i]))
const cuts = [0]
for (let i = 1; i < groupCount; i++) {
  const balanced = Math.floor(i * sorted.length / groupCount)
  const lo = cuts[i - 1] + 1, hi = sorted.length - (groupCount - i) // keeps every group non-empty
  const near = boundaries.filter(b => b >= lo && b <= hi && Math.abs(b - balanced) <= snapWindow)
    .sort((x, y) => Math.abs(x - balanced) - Math.abs(y - balanced) || x - y)
  cuts.push(near.length ? near[0] : Math.min(hi, Math.max(lo, balanced)))
}
cuts.push(sorted.length)
const groups = cuts.slice(1).map((end, i) => sorted.slice(cuts[i], end))
// The spawn count is stated before the first reviewer starts, so the cost is known up front.
const spawns = groups.length + 2
log(`${files.length} files -> ${groups.length} group reviewers (sonnet) + 1 whole-change reviewer (${modelB}) + 1 merger = ${spawns} agents`)

const SHARED = [
  `Intent (acceptance criteria verbatim): ${intent}`,
  `Effort: ${effort}.`,
  'Status: PASS (nothing wrong; `checked` names the passes run and what you read), ISSUES (findings), BLOCKED (you could not review; `blockedReason`).',
  'Values verbatim: CONFIRMED/PLAUSIBLE, P1|P2|P3, alto|medio|basso, S|M|L, category slugs. title, failure and forAuthor in Italian.',
]
const allFilesText = files.length <= LIST_ALL_MAX
  ? `All the changed files: ${sorted.join(', ')}.`
  : `The change has ${files.length} files in: ${[...new Set(sorted.map(dirOf))].join(', ')}.`
const brief = group => [
  `Review your part of one change. Scope: \`git diff ${range} -- ${group.map(f => `'${f}'`).join(' ')}\`.`,
  `These ${group.length} file(s) are yours: read them in full. ${files.length - group.length} other changed file(s) belong to other reviewers: read them only to judge callers and contracts of yours. ${allFilesText}`,
  'Another reviewer, on a second model, reads the whole change for what a group cannot see: you cover the per-file defects.',
  ...SHARED,
].join('\n')
const briefWhole = [
  `Review the WHOLE change. Scope: \`git diff ${range} -- ${sorted.map(f => `'${f}'`).join(' ')}\`.`,
  `The groups cover per-file defects (${groups.length} reviewers, each reading its own files in full). You see what a group cannot: a contract or signature changed in one file and used in another, callers left behind, the same rule applied inconsistently across files, missing pieces of the intent. ${allFilesText}`,
  'Report what you see, do not soften for agreement with the group reviewers.',
  ...SHARED,
].join('\n')

phase('Review')
const run = (prompt, opts, who) => () => agent(prompt, { phase: 'Review', agentType: 'code-reviewer', schema: REVIEW, effort, ...opts })
  .then(r => settle(r, who), () => settle(null, who))
const reviews = await parallel([
  ...groups.map(group => run(brief(group), { label: `review ${group[0]}${group.length > 1 ? ` +${group.length - 1}` : ''}` }, { files: group, reviewer: 'A', model: 'sonnet' })),
  run(briefWhole, { label: 'whole change (cross-file)', model: modelB }, { files: sorted, reviewer: 'B', model: modelB }),
])

const results = reviews.filter(Boolean)
const gaps = results.filter(r => r.status === 'BLOCKED').length
if (gaps) log(`${gaps} worker(s) blocked: their files are reported as not reviewed.`)

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
  reviewer: r.reviewer, model: r.model, files: r.files, status: r.status,
  checked: (r.checked ?? '').slice(0, 300), blockedReason: r.blockedReason, intentNotes: r.intentNotes,
}))
const mergerInput = { workers, findings: findings.map(compact) }

const rawTable = () => [
  '| # | Priorità | Verdetto | Categoria | Posizione | Rilievo | Trovato da |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...findings.map((f, i) => `| ${i + 1} | ${f.priority ?? '-'} | ${f.verdict} | ${f.category} | ${f.anchor} | ${f.title} | ${f.foundBy} |`),
  '',
  `Lacune: ${workers.filter(w => w.status === 'BLOCKED').map(w => `${w.reviewer} ${(w.files ?? []).join(', ')}`).join('; ') || 'nessuna'}`,
].join('\n')

// Mandatory report skeleton: byte-identical to the one in skills/code-review/references/report-format.md
// (tools/validate.mjs compares them). Inline because the merger does not read the kit.
const SKELETON = `Order: Rilievi → Completezza → Da fare → Già fatti → Fix rapidi → Verdetto. Tables last; after
Verdetto at most one short question.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdetto.
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
  `Range ${range} · ${files.length} files · effort ${effort} · reviewers: A sonnet (groups), B ${modelB} (whole change).`,
  'Your final text IS the report shown to the user: no preamble, no restated inputs, no JSON.',
  `Results (JSON):\n${JSON.stringify(mergerInput)}`,
].join('\n\n'), { label: 'merge the reviews into one report', phase: 'Merge', model: 'sonnet' }).catch(() => null)

return report ?? `review-large: the merger returned nothing (${results.length} worker results, ${gaps} gap(s)); raw findings, unmerged:\n\n${rawTable()}`
