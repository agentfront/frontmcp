# AgentScript Language Reference

AgentScript is a restricted JavaScript subset designed for safe AI agent orchestration. It allows agents to chain multiple tool calls, transform data, and implement simple logic without risking sandbox escape.

## Quick Reference

```javascript
// Call a tool and await its result
const result = await callTool('toolName', { arg1: 'value', arg2: 123 });

// Iterate over results
for (const item of result.items) {
  const detail = await callTool('getDetail', { id: item.id });
  // process detail...
}

// Return final result
return processedData;
```

## callTool Function

The primary API for invoking tools:

```javascript
await callTool(toolName: string, arguments: object): Promise<any>
```

| Parameter   | Type     | Description                                                    |
| ----------- | -------- | -------------------------------------------------------------- |
| `toolName`  | `string` | The tool identifier (e.g., `'users:list'`, `'billing:create'`) |
| `arguments` | `object` | Tool arguments as key-value pairs                              |

**Returns:** The tool's response (type depends on the tool).

## Allowed Features

| Feature            | Status  | Example                                            |
| ------------------ | ------- | -------------------------------------------------- |
| `await callTool()` | Allowed | `await callTool('api:get', { id: 1 })`             |
| `for...of` loops   | Allowed | `for (const x of items) { }`                       |
| `for` loops        | Allowed | `for (let i = 0; i < 10; i++) { }`                 |
| Arrow functions    | Allowed | `items.map(x => x.id)`                             |
| Array methods      | Allowed | `map`, `filter`, `reduce`, `find`, `some`, `every` |
| Object literals    | Allowed | `{ key: 'value' }`                                 |
| Template literals  | Allowed | `` `Hello ${name}` ``                              |
| Destructuring      | Allowed | `const { id, name } = user`                        |
| Spread operator    | Allowed | `[...items, newItem]`                              |
| `if/else`          | Allowed | `if (x > 0) { } else { }`                          |
| Ternary            | Allowed | `x > 0 ? 'yes' : 'no'`                             |
| `Math` methods     | Allowed | `Math.max()`, `Math.floor()`, `Math.round()`       |
| `JSON` methods     | Allowed | `JSON.parse()`, `JSON.stringify()`                 |
| String methods     | Allowed | `str.includes()`, `str.split()`, `str.trim()`      |
| Array methods      | Allowed | `arr.push()`, `arr.slice()`, `arr.concat()`        |

## Blocked Features

| Feature                     | Reason                 |
| --------------------------- | ---------------------- |
| `eval()`, `Function()`      | Code execution         |
| `while`, `do...while`       | Unbounded loops        |
| `function` declarations     | No recursion (v1)      |
| `async function`            | Only top-level async   |
| `process`, `require`        | System access          |
| `fetch`, `XMLHttpRequest`   | Network access         |
| `setTimeout`, `setInterval` | Timing attacks         |
| `Proxy`, `Reflect`          | Metaprogramming        |
| `constructor`, `__proto__`  | Prototype manipulation |
| `window`, `globalThis`      | Global access          |
| `eval`, `Function`          | Dynamic code execution |

## Code Structure

All AgentScript code must be wrapped in the main function:

```javascript
async function __ag_main() {
  // Your code here
  return result;
}
```

The transformer handles this wrapping automatically - you only need to write the inner code.

## Examples

### Example 1: Simple Tool Call

```javascript
const user = await callTool('users:get', { id: 123 });
return { name: user.name, email: user.email };
```

### Example 2: Iterate and Aggregate

```javascript
const orders = await callTool('orders:list', { status: 'pending' });

const totals = [];
for (const order of orders.items) {
  const items = await callTool('orders:getItems', { orderId: order.id });
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  totals.push({ orderId: order.id, total: Math.round(total * 100) / 100 });
}

return totals;
```

### Example 3: Filter and Transform

```javascript
const users = await callTool('users:list', { limit: 100 });

// Filter active admins
const admins = users.items.filter((u) => u.role === 'admin' && u.active);

// Get detailed info for each
const details = [];
for (const admin of admins) {
  const profile = await callTool('users:getProfile', { userId: admin.id });
  details.push({
    id: admin.id,
    name: admin.name,
    department: profile.department,
    lastLogin: profile.lastLogin,
  });
}

return details.sort((a, b) => a.name.localeCompare(b.name));
```

### Example 4: Conditional Logic

```javascript
const config = await callTool('config:get', { key: 'feature_flags' });

if (config.enableNewFeature) {
  const result = await callTool('newApi:process', { data: inputData });
  return { source: 'new', result };
} else {
  const result = await callTool('legacyApi:process', { data: inputData });
  return { source: 'legacy', result };
}
```

### Example 5: Data Aggregation

```javascript
const accounts = await callTool('accounts:list', { type: 'premium' });

const summary = {
  totalAccounts: accounts.items.length,
  totalRevenue: 0,
  byRegion: {},
};

for (const account of accounts.items) {
  const billing = await callTool('billing:getSummary', { accountId: account.id });

  summary.totalRevenue += billing.totalSpend;

  const region = account.region || 'unknown';
  if (!summary.byRegion[region]) {
    summary.byRegion[region] = { count: 0, revenue: 0 };
  }
  summary.byRegion[region].count += 1;
  summary.byRegion[region].revenue += billing.totalSpend;
}

return summary;
```

## Error Handling

AgentScript does not allow try/catch blocks (v1). Tool errors propagate to the runtime which handles them appropriately. Design your code to handle expected cases via conditional logic:

```javascript
const user = await callTool('users:get', { id: userId });

// Check for expected conditions
if (!user || !user.active) {
  return { error: 'User not found or inactive', userId };
}

// Continue with valid user
return { success: true, userName: user.name };
```

## Limits

The Enclave runtime enforces these limits (defaults vary by security level):

| Limit              | STRICT  | SECURE  | STANDARD | PERMISSIVE |
| ------------------ | ------- | ------- | -------- | ---------- |
| **Timeout**        | 2,000ms | 3,500ms | 5,000ms  | 10,000ms   |
| **Max Iterations** | 2,000   | 5,000   | 10,000   | 20,000     |
| **Max Tool Calls** | 10      | 100     | 200      | 500        |
| **Console Output** | 32KB    | 64KB    | 256KB    | 1MB        |
| **Console Calls**  | 50      | 100     | 500      | 1,000      |

**Note:** Memory limits are enforced by the VM sandbox configuration. Use the `SECURE` preset for production workloads.

## Reserved Identifiers

Do not use these prefixes in your code:

- `__ag_` - Reserved for AgentScript internals
- `__safe_` - Reserved for transformed identifiers
