export const meta = { name: 'w', description: 'fixture', whenToUse: 'never', phases: [] }
const out = await agent('hi', { agentType: 'helper', model: 'sonnet' })
return out
