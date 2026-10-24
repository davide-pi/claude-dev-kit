---
tags: [react]
plugins: [../../../skills/react, ../../../skills/angular]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Questo componente React (Orders.tsx) rifà la fetch in loop e lo stato del filtro è duplicato:

```tsx
export function Orders({ filter }: { filter: string }) {
  const [rows, setRows] = useState<Order[]>([]);
  const [f, setF] = useState(filter);
  fetch(`/api/orders?f=${f}`).then((r) => r.json()).then(setRows);
  return <ul>{rows.map((o) => <li key={o.id}>{o.name}</li>)}</ul>;
}
```
