/**
 * AgentScript tool description for AI agents
 *
 * Use this constant in your CodeCall tool description to help AI agents
 * understand how to write valid AgentScript code.
 */

/**
 * Short description (~500 chars) for space-constrained tool descriptions
 */
export const AGENTSCRIPT_DESCRIPTION_SHORT = `AgentScript: Safe JS subset for tool orchestration.

API: \`await callTool(name, args)\` - returns tool result

Allowed: for/for-of loops, arrow functions, array methods (map/filter/reduce), Math, JSON, if/else

Blocked: while loops, function declarations, eval, require, fetch, setTimeout

Example:
const users = await callTool('users:list', { active: true });
return users.items.map(u => ({ id: u.id, name: u.name }));`;

/**
 * Medium description (~1500 chars) for standard tool descriptions
 */
export const AGENTSCRIPT_DESCRIPTION_MEDIUM = `Execute AgentScript - a restricted JavaScript subset for safe AI agent orchestration.

## callTool Function
\`\`\`javascript
await callTool(toolName: string, args: object): Promise<any>
\`\`\`
- \`toolName\`: Tool identifier (e.g., 'users:list', 'orders:create')
- \`args\`: Object with tool arguments

## Allowed Features
- Loops: \`for\`, \`for...of\` (bounded iteration)
- Arrow functions: \`x => x.id\`, \`(a, b) => a + b\`
- Array methods: \`map\`, \`filter\`, \`reduce\`, \`find\`, \`some\`, \`every\`, \`sort\`
- Math: \`Math.max()\`, \`Math.min()\`, \`Math.round()\`, \`Math.floor()\`
- JSON: \`JSON.parse()\`, \`JSON.stringify()\`
- Control flow: \`if/else\`, ternary \`? :\`
- Syntax: destructuring, spread \`...\`, template literals

## Blocked Features
- Unbounded loops: \`while\`, \`do...while\`
- Function declarations (no recursion)
- System access: \`process\`, \`require\`, \`eval\`, \`Function\`
- Network: \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`
- Timers: \`setTimeout\`, \`setInterval\`
- Globals: \`window\`, \`globalThis\`, \`this\`

## Example
\`\`\`javascript
const accounts = await callTool('accounts:list', { type: 'premium' });
const results = [];
for (const acc of accounts.items) {
  const billing = await callTool('billing:get', { accountId: acc.id });
  results.push({ id: acc.id, amount: billing.amount });
}
return results;
\`\`\`

Limits: Max 10,000 loop iterations, 30s execution timeout.`;

/**
 * Full description (~2500 chars) for detailed tool documentation
 */
export const AGENTSCRIPT_DESCRIPTION_FULL = `Execute AgentScript code to orchestrate multiple tool calls safely.

AgentScript is a restricted JavaScript subset designed for AI agent orchestration. It allows chaining tool calls, transforming data, and implementing logic without sandbox escape risks.

## callTool API
\`\`\`javascript
await callTool(toolName: string, args: object): Promise<any>
\`\`\`
| Parameter | Type | Description |
|-----------|------|-------------|
| \`toolName\` | string | Tool identifier (e.g., 'users:list') |
| \`args\` | object | Tool arguments as key-value pairs |

## Allowed Features
| Feature | Example |
|---------|---------|
| \`for\`, \`for...of\` loops | \`for (const x of items) { }\` |
| Arrow functions | \`items.map(x => x.id)\` |
| Array methods | \`map\`, \`filter\`, \`reduce\`, \`find\`, \`sort\` |
| Math methods | \`Math.max()\`, \`Math.round()\` |
| JSON methods | \`JSON.parse()\`, \`JSON.stringify()\` |
| Control flow | \`if/else\`, ternary \`? :\` |
| Destructuring | \`const { id, name } = user\` |
| Spread | \`[...items, newItem]\` |
| Template literals | \`\\\`Hello \${name}\\\`\` |

## Blocked Features
| Feature | Reason |
|---------|--------|
| \`while\`, \`do...while\` | Unbounded loops |
| \`function\` declarations | No recursion |
| \`eval\`, \`Function\` | Code execution |
| \`process\`, \`require\` | System access |
| \`fetch\`, \`XMLHttpRequest\` | Network access |
| \`setTimeout\` | Timing attacks |
| \`window\`, \`globalThis\` | Global access |

## Example: Data Aggregation
\`\`\`javascript
const users = await callTool('users:list', { role: 'admin', active: true });

const results = [];
for (const user of users.items) {
  const orders = await callTool('orders:list', { userId: user.id });
  const total = orders.items.reduce((sum, o) => sum + o.amount, 0);
  results.push({
    userId: user.id,
    name: user.name,
    orderCount: orders.items.length,
    totalAmount: Math.round(total * 100) / 100
  });
}

return results.sort((a, b) => b.totalAmount - a.totalAmount);
\`\`\`

## Limits
- Max 10,000 iterations per loop
- 30 second execution timeout
- No try/catch (errors propagate to runtime)`;

/**
 * Default export - the medium description is recommended for most use cases
 */
export const AGENTSCRIPT_DESCRIPTION = AGENTSCRIPT_DESCRIPTION_MEDIUM;
