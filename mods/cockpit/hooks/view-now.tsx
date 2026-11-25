import { flowOf, outsideAgents, requestOf } from './now-model'
import type { StepState } from './now-model'
import { COLORS, textCells, truncateSpans } from './shared'
import type { Span } from './shared'
import { t } from './strings'
import { dim, line, sp } from './view-base'
import { collapsible, makeAgentBlock } from './view-kit'
import type { Block, Kit } from './view-kit'

// ── The terminal's In corso tab, as the desktop draws it: the request, the flow and the agents outside it, each a title over its rows ──

/** Agent rows shown; a button opens the rest. */
const MAX_AGENTS = 5
const STEP_COLOR: Record<StepState, string> = { done: COLORS.green, failed: COLORS.red, running: COLORS.title }

/** The `In corso` tab: request, flow and agents outside the flow; an empty one says so in one dim line. */
export function nowSections(k: Kit): Block[] {
  const { ui, s, width, title, actions } = k

  const S = t().desk.now
  const cut = (spans: readonly Span[]) => line(ui, truncateSpans(spans, width))

  // REQUEST: the prompt; its facts (round, start, duration, cost) on the title when they fit
  const { isOpen, prompt, facts } = requestOf(s)
  const hasFacts = facts.trim() !== '' && textCells(S.request) + textCells(facts) + 3 <= width
  const request: Block = [title(S.request, hasFacts ? facts : undefined), cut([isOpen ? sp(prompt, COLORS.text) : dim(prompt)])]

  // FLOW: the run still open, its cycle and the steps of its newest block
  const flow = flowOf(s)
  const tone = flow.isSilent ? COLORS.yellow : COLORS.title
  const flowRows = flow.isLive
    ? [
        cut([sp('◆ ', tone), sp(flow.name, flow.isSilent ? COLORS.yellow : COLORS.text, true), dim(` · ${flow.cycle}`)]),
        cut(flow.segments.length === 0 ? [sp(' ')] : [dim(`${S.step} `), ...flow.segments.flatMap((seg, i) => [...(i > 0 ? [dim(' › ')] : []), sp(t().page.planStep(seg.step), STEP_COLOR[seg.state])])]),
      ]
    : [cut([dim(S.noFlow)]), cut([sp(' ')])]

  // AGENTS OUTSIDE THE FLOW: the running ones no run claims, each a row a press opens
  const outside = outsideAgents(s)
  const agentBlock = makeAgentBlock(k)
  const agentRows: Block =
    outside.length === 0
      ? [cut([dim(S.noAgents)])]
      : [collapsible(k, 'inProgress', outside.map(({ agent, depth }) => agentBlock(`agent:${agent.id}`, agent, depth)), MAX_AGENTS, s.openKeys?.includes('inProgress') === true, () => actions.toggleOpen('inProgress'))]

  return [request, [title(S.flow), ...flowRows], [title(S.outside), ...agentRows]]
}
