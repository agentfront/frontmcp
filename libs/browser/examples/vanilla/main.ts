/**
 * FrontMCP Browser - Vanilla JavaScript Example
 *
 * This example demonstrates:
 * - Creating a BrowserMcpServer with just a name
 * - Adding tools and resources
 * - Using the Valtio store for reactive state
 * - Calling tools and reading resources
 */

import { BrowserMcpServer, createMcpStore } from '@frontmcp/browser';

// =============================================================================
// Store Setup
// =============================================================================

interface AppState {
  count: number;
  user: {
    name: string;
    email: string;
  } | null;
  lastAction: string;
}

const store = createMcpStore<AppState>({
  initialState: {
    count: 0,
    user: null,
    lastAction: 'initialized',
  },
});

// =============================================================================
// Server Setup
// =============================================================================

// Create server with just a name - transport is created internally
const server = new BrowserMcpServer({
  name: 'vanilla-example',
  store,
});

// Add a greeting tool
server.addTool({
  name: 'greet',
  description: 'Greet someone by name',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name to greet' },
    },
    required: ['name'],
  },
  handler: async (args) => {
    const name = args['name'] as string;
    store.state.lastAction = `Greeted ${name}`;
    return { message: `Hello, ${name}!`, timestamp: new Date().toISOString() };
  },
});

// Add a time tool
server.addTool({
  name: 'get-time',
  description: 'Get the current time',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    store.state.lastAction = 'Got time';
    return {
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString(),
      timestamp: Date.now(),
    };
  },
});

// Add counter tools
server.addTool({
  name: 'increment',
  description: 'Increment the counter',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    store.state.count++;
    store.state.lastAction = 'increment';
    return { count: store.state.count };
  },
});

server.addTool({
  name: 'decrement',
  description: 'Decrement the counter',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    store.state.count--;
    store.state.lastAction = 'decrement';
    return { count: store.state.count };
  },
});

server.addTool({
  name: 'reset',
  description: 'Reset the counter to zero',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    store.state.count = 0;
    store.state.lastAction = 'reset';
    return { count: 0 };
  },
});

// Add store resource
server.addResource({
  uri: 'store://state',
  name: 'Application State',
  description: 'Current application state from Valtio store',
  handler: async () => ({
    contents: [
      {
        uri: 'store://state',
        mimeType: 'application/json',
        text: JSON.stringify(store.getSnapshot(), null, 2),
      },
    ],
  }),
});

// Add config resource
server.addResource({
  uri: 'config://app',
  name: 'Application Config',
  description: 'Application configuration',
  handler: async () => ({
    contents: [
      {
        uri: 'config://app',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            name: 'Vanilla Example',
            version: '1.0.0',
            features: ['store', 'tools', 'resources'],
          },
          null,
          2,
        ),
      },
    ],
  }),
});

// =============================================================================
// UI Helpers
// =============================================================================

function log(type: string, data: unknown) {
  const logEl = document.getElementById('log');
  if (!logEl) return;

  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-type">${type}</span>: <span class="log-data">${JSON.stringify(
    data,
    null,
    2,
  )}</span>`;

  // Insert at top
  logEl.insertBefore(entry, logEl.firstChild);

  // Limit to 20 entries
  while (logEl.children.length > 20) {
    logEl.removeChild(logEl.lastChild!);
  }
}

function updateUI() {
  const state = store.getSnapshot();

  const countEl = document.getElementById('count');
  if (countEl) countEl.textContent = String(state.count);

  const userEl = document.getElementById('user');
  if (userEl) {
    userEl.textContent = state.user ? `${state.user.name} (${state.user.email})` : 'Not set';
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

async function init() {
  // Start the server
  await server.start();
  log('server', 'Started');

  // Subscribe to store changes
  store.subscribe((state) => {
    log('state-change', { count: state.count, lastAction: state.lastAction });
    updateUI();
  });

  // Initial UI update
  updateUI();

  // Button handlers
  document.getElementById('increment')?.addEventListener('click', async () => {
    const result = await server.callTool('increment', {});
    log('tool-result', result);
  });

  document.getElementById('decrement')?.addEventListener('click', async () => {
    const result = await server.callTool('decrement', {});
    log('tool-result', result);
  });

  document.getElementById('reset')?.addEventListener('click', async () => {
    const result = await server.callTool('reset', {});
    log('tool-result', result);
  });

  document.getElementById('call-greet')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('greet-name') as HTMLInputElement;
    const name = nameInput?.value || 'World';
    const result = await server.callTool('greet', { name });
    log('tool-result', result);
  });

  document.getElementById('call-get-time')?.addEventListener('click', async () => {
    const result = await server.callTool('get-time', {});
    log('tool-result', result);
  });

  document.getElementById('list-tools')?.addEventListener('click', () => {
    const tools = server.getTools();
    log('tools', tools);
  });

  document.getElementById('list-resources')?.addEventListener('click', () => {
    const resources = server.getResources();
    log('resources', resources);
  });

  document.getElementById('read-store')?.addEventListener('click', async () => {
    const result = await server.readResource('store://state');
    const text = result.contents[0]?.text;
    log('resource', text ? JSON.parse(text) : result);
  });

  document.getElementById('read-config')?.addEventListener('click', async () => {
    const result = await server.readResource('config://app');
    const text = result.contents[0]?.text;
    log('resource', text ? JSON.parse(text) : result);
  });

  log('init', 'Ready! Click buttons to interact.');
}

// Start the app
init().catch((err) => {
  console.error('Failed to initialize:', err);
  log('error', err.message);
});
