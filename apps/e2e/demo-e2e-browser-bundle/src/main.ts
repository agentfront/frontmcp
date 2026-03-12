import 'reflect-metadata';

// ── @frontmcp/utils imports ──
import {
  getEnv,
  getCwd,
  isProduction,
  isDevelopment,
  getEnvFlag,
  isDebug,
  isEdgeRuntime,
  isServerless,
  supportsAnsi,
  randomUUID,
  sha256Hex,
  base64urlEncode,
  base64urlDecode,
  AsyncLocalStorage,
  EventEmitter,
} from '@frontmcp/utils';

// ── @frontmcp/sdk imports (decorators, types, core) ──
import { FrontMcp, Tool, ToolContext, Resource, ResourceContext, Prompt, PromptContext } from '@frontmcp/sdk';
import { z } from 'zod';

// ── Test results container ──
const results: Record<string, { pass: boolean; value: string }> = {};

function check(name: string, fn: () => unknown) {
  try {
    const value = fn();
    results[name] = { pass: true, value: String(value) };
  } catch (e) {
    results[name] = { pass: false, value: String(e) };
  }
}

// ── @frontmcp/utils checks ──
check('getEnv', () => getEnv('NODE_ENV')); // should be undefined (browser stub)
check('getEnv-default', () => getEnv('X', 'fb')); // should return 'fb'
check('getCwd', () => getCwd()); // should be '/'
check('isProduction', () => isProduction()); // false
check('isDevelopment', () => isDevelopment()); // false
check('getEnvFlag', () => getEnvFlag('DEBUG')); // false
check('isDebug', () => isDebug()); // false
check('isEdgeRuntime', () => isEdgeRuntime()); // false
check('isServerless', () => isServerless()); // false
check('supportsAnsi', () => supportsAnsi()); // false
check('randomUUID', () => {
  const id = randomUUID();
  return /^[0-9a-f-]{36}$/.test(id) ? id : 'INVALID';
});
check('sha256Hex', () => typeof sha256Hex === 'function');
check('base64url-roundtrip', () => {
  const encoded = base64urlEncode(new TextEncoder().encode('hello'));
  const decoded = new TextDecoder().decode(base64urlDecode(encoded));
  return decoded === 'hello';
});
check('AsyncLocalStorage', () => {
  const als = new AsyncLocalStorage<string>();
  let captured: string | undefined;
  als.run('test-value', () => {
    captured = als.getStore();
  });
  return captured;
});
check('EventEmitter', () => {
  const emitter = new EventEmitter();
  let received = false;
  emitter.on('test', () => {
    received = true;
  });
  emitter.emit('test');
  return received;
});

// ── @frontmcp/sdk decorator checks ──
check('Tool-decorator', () => {
  @Tool({
    name: 'browser_test',
    description: 'A tool defined in the browser',
    inputSchema: { message: z.string() },
  })
  class BrowserTestTool extends ToolContext<{ message: z.ZodString }> {
    async execute(input: { message: string }) {
      return { content: [{ type: 'text' as const, text: input.message }] };
    }
  }
  return typeof BrowserTestTool === 'function';
});

check('Resource-decorator', () => {
  @Resource({ uri: 'test://browser', name: 'browser_resource' })
  class BrowserResource extends ResourceContext {
    async execute() {
      return { contents: [{ uri: 'test://browser', text: 'browser resource' }] };
    }
  }
  return typeof BrowserResource === 'function';
});

check('Prompt-decorator', () => {
  @Prompt({ name: 'browser_prompt', description: 'A prompt in the browser', arguments: [] })
  class BrowserPrompt extends PromptContext {
    async execute() {
      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'hello' } }],
      };
    }
  }
  return typeof BrowserPrompt === 'function';
});

check('FrontMcp-decorator', () => {
  @FrontMcp({ info: { name: 'browser-test', version: '0.0.1' }, apps: [], serve: false })
  class BrowserApp {}
  return typeof BrowserApp === 'function';
});

// ── Render results to DOM ──
const app = document.getElementById('app');
if (!app) {
  throw new Error('Required DOM element #app not found');
}
const summary = Object.values(results);
const passed = summary.filter((r) => r.pass).length;
const failed = summary.filter((r) => !r.pass).length;

// Build DOM safely using textContent to avoid XSS from error strings containing HTML
const heading = document.createElement('h1');
heading.textContent = 'FrontMCP Browser Bundle E2E';
app.appendChild(heading);

const summaryP = document.createElement('p');
summaryP.dataset.testid = 'summary';
summaryP.textContent = `${passed} passed, ${failed} failed`;
app.appendChild(summaryP);

const table = document.createElement('table');
const thead = document.createElement('thead');
const headerRow = document.createElement('tr');
for (const h of ['Check', 'Status', 'Value']) {
  const th = document.createElement('th');
  th.textContent = h;
  headerRow.appendChild(th);
}
thead.appendChild(headerRow);
table.appendChild(thead);

const tbody = document.createElement('tbody');
for (const [name, r] of Object.entries(results)) {
  const tr = document.createElement('tr');
  tr.dataset.testid = `check-${name}`;
  tr.dataset.status = r.pass ? 'pass' : 'fail';

  const tdName = document.createElement('td');
  tdName.textContent = name;
  tr.appendChild(tdName);

  const tdStatus = document.createElement('td');
  tdStatus.textContent = r.pass ? '\u2705' : '\u274c';
  tr.appendChild(tdStatus);

  const tdValue = document.createElement('td');
  tdValue.textContent = r.value;
  tr.appendChild(tdValue);

  tbody.appendChild(tr);
}
table.appendChild(tbody);
app.appendChild(table);

// Expose for Playwright assertions
(window as unknown as Record<string, unknown>).__BUNDLE_RESULTS__ = results;
