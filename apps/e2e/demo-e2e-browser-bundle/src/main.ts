import 'reflect-metadata';

// ── @frontmcp/adapters/skills imports (browser-safe pure primitives) ──
//
// These are the runtime-agnostic units the skills adapter + the
// skilled-openapi plugin both build on: a markdown op-reference harvester,
// the OpenAPI → MCP classifier, an in-memory classification registry, a
// resource-URI template renderer, and the overlay/bundle JSON parser.
// None of these touch the filesystem or process.env — they're pure
// functions / pure-data classes, so the same code that runs the parity
// e2e in Node also boots cleanly inside a browser bundle.
import {
  ClassificationRegistry,
  classifyOne,
  classifyOperations,
  dedupeOpReferences,
  extractOpReferences,
  parseOverlay,
  renderResourceUri,
} from '@frontmcp/adapters/skills';
import { z } from '@frontmcp/lazy-zod';
// ── @frontmcp/sdk imports (decorators, types, core) ──
import {
  App,
  ConfigPlugin,
  ConfigService,
  connect,
  FrontMcp,
  FrontMcpInstance,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';
// ── @frontmcp/utils imports ──
import {
  AsyncLocalStorage,
  base64urlDecode,
  base64urlEncode,
  EventEmitter,
  getCwd,
  getEnv,
  getEnvFlag,
  isDebug,
  isDevelopment,
  isEdgeRuntime,
  isProduction,
  isServerless,
  randomUUID,
  sha256Hex,
  supportsAnsi,
} from '@frontmcp/utils';

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

const pendingChecks: Promise<void>[] = [];

function checkAsync(name: string, fn: () => Promise<unknown>) {
  pendingChecks.push(
    fn().then(
      (value) => {
        results[name] = { pass: true, value: String(value) };
      },
      (error: unknown) => {
        results[name] = { pass: false, value: String(error) };
      },
    ),
  );
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

// ── @frontmcp/sdk entry points that never listen (#747) ──
@Tool({ name: 'ping', inputSchema: {} })
class BrowserPingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'browser-entry', name: 'Browser entry', tools: [BrowserPingTool] })
class BrowserEntryApp {}

const browserEntryConfig = { info: { name: 'browser-entry', version: '0.0.1' }, apps: [BrowserEntryApp] };

checkAsync('createFetchHandler', async () => {
  const handler = await FrontMcpInstance.createFetchHandler(browserEntryConfig);
  const response = await handler(new Request(`${location.origin}/healthz`));
  if (response.status !== 200) throw new Error(`/healthz answered ${response.status}`);
  return response.status;
});

checkAsync('createDirect', async () => {
  const server = await FrontMcpInstance.createDirect(browserEntryConfig);
  try {
    const { tools } = await server.listTools();
    return tools.map((tool) => tool.name).join(',');
  } finally {
    await server.dispose();
  }
});

// ── connect() and ConfigPlugin in the browser (#761) ──
checkAsync('connect', async () => {
  const client = await connect({ ...browserEntryConfig, info: { name: 'browser-connect', version: '0.0.1' } });
  try {
    const tools = (await client.listTools()) as Array<{ name: string }>;
    return tools.map((tool) => tool.name).join(',');
  } finally {
    await client.close();
  }
});

@Tool({ name: 'page_size', inputSchema: {} })
class BrowserPageSizeTool extends ToolContext {
  async execute() {
    return { pageSize: this.get(ConfigService).getNumber('pageSize') };
  }
}

@App({
  id: 'browser-config',
  name: 'Browser config',
  tools: [BrowserPageSizeTool],
  plugins: [ConfigPlugin.init({ schema: z.object({ pageSize: z.coerce.number().default(20) }) })],
})
class BrowserConfigApp {}

checkAsync('ConfigPlugin', async () => {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'browser-config', version: '0.0.1' },
    apps: [BrowserConfigApp],
  });
  try {
    const result = await server.callTool('page_size', {});
    return JSON.stringify(result.structuredContent);
  } finally {
    await server.dispose();
  }
});

// ── @frontmcp/adapters/skills checks ──
//
// The harvester + classifier + registry are the load-bearing units that
// the skilled-openapi plugin (and any future skills-aware integration)
// builds on. Exercising them in a browser bundle proves they're truly
// runtime-agnostic — a regression that drags in `node:fs` or
// `node:crypto` would fail webpack/vite's browser target, AND any
// runtime guard fall-through would surface as a thrown error in these
// checks.

check('extractOpReferences-markdown', () => {
  const md = 'See [[op:acme/getUser]] and use op://acme/updateUser to mutate.';
  const refs = extractOpReferences(md);
  // We expect both styles to be picked up; order isn't part of the contract.
  return (
    refs.length === 2 &&
    refs.some((r) => r.operationId === 'getUser') &&
    refs.some((r) => r.operationId === 'updateUser')
  );
});

check('dedupeOpReferences-stable', () => {
  const md = '[[op:acme/getUser]] [[op:acme/getUser]] op://acme/getUser';
  const refs = dedupeOpReferences(extractOpReferences(md));
  return refs.length === 1 && refs[0]?.operationId === 'getUser';
});

check('classifyOperations-tool-and-resource', () => {
  // A GET-with-path-param classifies as `both` (tool + resource); POST on
  // the same template classifies as `tool` and emits an updated event.
  const ops = [
    { operationId: 'getUser', method: 'GET' as const, path: '/users/{id}' },
    { operationId: 'updateUser', method: 'POST' as const, path: '/users/{id}' },
  ];
  const classified = classifyOperations('acme', ops);
  const get = classified.find((c) => c.operationId === 'getUser');
  const post = classified.find((c) => c.operationId === 'updateUser');
  if (!get || !post) return false;
  return get.expose === 'both' && post.expose === 'tool';
});

check('classifyOne-pathsWithGet', () => {
  const c = classifyOne('acme', { operationId: 'createUser', method: 'POST', path: '/users' }, new Set(['/users']));
  // POST /users with a GET on the same template → still tool, but with
  // an emit kind targeting the list resource.
  return c.expose === 'tool' && c.emit?.kind === 'listChanged';
});

check('ClassificationRegistry-roundtrip', () => {
  const reg = new ClassificationRegistry();
  const [c] = classifyOperations('acme', [{ operationId: 'getUser', method: 'GET', path: '/users/{id}' }]);
  if (!c) return false;
  reg.register('acme.getUser', c);
  const stored = reg.lookup('acme.getUser');
  return stored?.operationId === 'getUser';
});

check('renderResourceUri-template', () => {
  const rendered = renderResourceUri('mcp+op://acme/users/{id}', { id: '42' });
  return rendered.ok === true && rendered.uri === 'mcp+op://acme/users/42';
});

check('parseOverlay-json', () => {
  // A minimal ResolvedBundle JSON document. parseOverlay normalises it
  // into the canonical bundle shape the static-source consumer expects.
  const json = JSON.stringify({
    schemaVersion: 1,
    bundleId: 'browser-demo',
    version: '0.0.1',
    generatedAt: new Date(0).toISOString(),
    sourceDigest: 'a'.repeat(64),
    services: [{ id: 'demo', baseUrl: 'https://api.example.com' }],
    authBindings: {},
    skills: [],
    operations: {},
  });
  const parsed = parseOverlay({ kind: 'json', content: json });
  return parsed.bundleId === 'browser-demo';
});

// ── Render results to DOM once every check has settled ──
function renderResults(): void {
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
}

void Promise.all(pendingChecks).then(renderResults);
