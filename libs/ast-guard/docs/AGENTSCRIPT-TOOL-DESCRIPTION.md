# AgentScript Tool Description

Condensed versions for embedding in CodeCall tool descriptions.

---

## Short Version (~500 chars)

> Execute AgentScript code - a safe JavaScript subset for orchestrating tool calls.
>
> **API:** `await callTool(name: string, args: object)` - Call a tool and return its result
>
> **Allowed:** `for`, `for...of` loops, arrow functions, array methods (map/filter/reduce), Math, JSON, if/else
>
> **Blocked:** while loops, function declarations, eval, require, fetch, setTimeout

**Example:**

```javascript
const users = await callTool('users:list', { role: 'admin' });
const active = users.items.filter((u) => u.active);

const results = [];
for (const user of active) {
  const orders = await callTool('orders:list', { userId: user.id });
  results.push({ userId: user.id, orderCount: orders.items.length });
}
return results;
```

---

## Medium Version (~1500 chars)

> Execute AgentScript - a restricted JavaScript subset for safe AI agent orchestration.
>
> **callTool Function:** `await callTool(toolName: string, args: object): Promise<any>`
>
> **Allowed Features:**
>
> - Loops: `for`, `for...of` (bounded iteration)
> - Arrow functions: `x => x.id`, `(a, b) => a + b`
> - Array methods: `map`, `filter`, `reduce`, `find`, `some`, `every`, `sort`
> - Math: `Math.max()`, `Math.min()`, `Math.round()`, `Math.floor()`
> - JSON: `JSON.parse()`, `JSON.stringify()`
> - Control flow: `if/else`, ternary `? :`
> - Syntax: destructuring, spread `...`, template literals
>
> **Blocked Features:**
>
> - Unbounded loops: `while`, `do...while`
> - Function declarations (no recursion)
> - System access: `process`, `require`, `eval`, `Function`
> - Network: `fetch`, `XMLHttpRequest`, `WebSocket`
> - Timers: `setTimeout`, `setInterval`
> - Globals: `window`, `globalThis`, `this`
>
> **Limits:** Max 10,000 loop iterations, 30s timeout

**Example:**

```javascript
const accounts = await callTool('accounts:list', { type: 'premium' });

const summary = { total: 0, count: accounts.items.length };
for (const acc of accounts.items) {
  const billing = await callTool('billing:get', { accountId: acc.id });
  summary.total += billing.amount;
}

return summary;
```

---

## Minimal Version (~300 chars)

> AgentScript: Safe JS subset for tool orchestration.
>
> API: `await callTool(name, args)` - returns tool result
>
> Allowed: for/for-of loops, arrow functions, array methods, Math, JSON, if/else
>
> Blocked: while loops, function declarations, eval, require, fetch, setTimeout

**Example:**

```javascript
const users = await callTool('users:list', { active: true });
return users.items.map((u) => ({ id: u.id, name: u.name }));
```

---

## TypeScript Export

Use these constants directly in your tool definitions:

```typescript
import {
  AGENTSCRIPT_DESCRIPTION,        // Medium (default, recommended)
  AGENTSCRIPT_DESCRIPTION_SHORT,  // Short (~500 chars)
  AGENTSCRIPT_DESCRIPTION_MEDIUM, // Medium (~1500 chars)
  AGENTSCRIPT_DESCRIPTION_FULL,   // Full (~2500 chars)
} from 'ast-guard';

// Example usage
const executeCodeTool = {
  name: 'execute_code',
  description: AGENTSCRIPT_DESCRIPTION,
  inputSchema: { ... }
};
```

---

## Raw Text (Copy-Paste Ready)

### For Tool Description Field

```text
Execute AgentScript code to orchestrate multiple tool calls.

callTool API: await callTool(toolName: string, args: object) - Invoke a tool and return its result.

Allowed: for/for-of loops, arrow functions, array methods (map, filter, reduce, find, sort), Math, JSON, if/else, ternary, destructuring, spread, template literals.

Blocked: while/do-while loops, function declarations, eval, Function, require, process, fetch, setTimeout, global access.

Example:
const users = await callTool('users:list', { role: 'admin', active: true });
const results = [];
for (const user of users.items) {
  const stats = await callTool('users:getStats', { userId: user.id });
  results.push({ name: user.name, totalOrders: stats.orderCount });
}
return results.sort((a, b) => b.totalOrders - a.totalOrders);

Limits: Max 10,000 iterations per loop, 30s timeout.
```
