---
tags: [angular]
plugins: [../../../skills/angular, ../../../skills/react]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Questo componente Angular (orders.component.ts) non aggiorna la vista quando lo store emette:

```ts
@Component({ selector: 'app-orders', templateUrl: './orders.component.html' })
export class OrdersComponent {
  orders: string[] = [];
  constructor(private store: OrdersStore) {
    this.store.orders$.subscribe((o) => (this.orders = o));
  }
}
```
