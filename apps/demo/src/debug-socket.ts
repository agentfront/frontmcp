/**
 * Debug Socket Client for ManagerService
 *
 * Connects to the FrontMCP ManagerService Unix socket and logs all events.
 * Useful for debugging event flow without the TUI.
 *
 * Usage:
 *   # Terminal 1: Start demo with manager enabled
 *   FRONTMCP_MANAGER_ENABLED=true npx tsx apps/demo/src/main.ts
 *
 *   # Terminal 2: Connect debug client (pass socket path as argument)
 *   npx tsx apps/demo/src/debug-socket.ts /tmp/frontmcp-<pid>.sock
 *
 *   # Or with env var:
 *   FRONTMCP_MANAGER_UNIX_PATH=/tmp/frontmcp-12345.sock npx tsx apps/demo/src/debug-socket.ts
 */

import * as net from 'net';
import * as readline from 'readline';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

function c(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function timestamp(): string {
  return c('gray', new Date().toISOString().slice(11, 23));
}

// Resolve socket path
const socketPath =
  process.env['FRONTMCP_MANAGER_UNIX_PATH'] ||
  process.argv[2] ||
  (() => {
    console.error(c('red', 'Error: No socket path provided'));
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx apps/demo/src/debug-socket.ts /tmp/frontmcp-<pid>.sock');
    console.error('');
    console.error('Or set FRONTMCP_MANAGER_UNIX_PATH environment variable');
    process.exit(1);
  })();

console.log(`${timestamp()} ${c('cyan', '[CONNECT]')} Connecting to ${c('bold', socketPath)}...`);

// Connect to socket
const socket = net.createConnection(socketPath);

socket.on('connect', () => {
  console.log(`${timestamp()} ${c('green', '[CONNECTED]')} Socket connection established`);
  console.log('');
});

socket.on('error', (err) => {
  console.error(`${timestamp()} ${c('red', '[ERROR]')} ${err.message}`);
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error(c('yellow', 'Hint: Make sure the server is running with FRONTMCP_MANAGER_ENABLED=true'));
  }
  process.exit(1);
});

socket.on('close', () => {
  console.log(`${timestamp()} ${c('yellow', '[CLOSED]')} Connection closed`);
  process.exit(0);
});

// Parse line-delimited JSON
const rl = readline.createInterface({ input: socket });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    handleMessage(msg);
  } catch (err) {
    console.log(`${timestamp()} ${c('red', '[PARSE_ERROR]')} ${line.slice(0, 100)}...`);
  }
});

interface WelcomeMessage {
  type: 'welcome';
  serverId: string;
  serverVersion: string;
  protocolVersion: string;
}

interface StateMessage {
  type: 'state';
  id: string;
  timestamp: number;
  state: {
    scopes: Array<{
      id: string;
      tools: Array<{ name: string }>;
      resources: Array<{ uri: string; name: string }>;
      prompts: Array<{ name: string }>;
      agents: Array<{ name: string }>;
    }>;
    sessions: Array<{
      scopeId: string;
      sessionId: string;
      transportType: string;
    }>;
    server: {
      name: string;
      version: string;
    };
  };
}

interface EventMessage {
  type: 'event';
  id: string;
  timestamp: number;
  event: {
    category: string;
    type: string;
    scopeId?: string;
    sessionId?: string;
    data?: Record<string, unknown>;
  };
}

interface ResponseMessage {
  type: 'response';
  commandId: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

type Message = WelcomeMessage | StateMessage | EventMessage | ResponseMessage;

function handleMessage(msg: Message): void {
  switch (msg.type) {
    case 'welcome':
      handleWelcome(msg);
      break;
    case 'state':
      handleState(msg);
      break;
    case 'event':
      handleEvent(msg);
      break;
    case 'response':
      handleResponse(msg);
      break;
    default:
      console.log(`${timestamp()} ${c('gray', '[UNKNOWN]')} ${JSON.stringify(msg).slice(0, 100)}`);
  }
}

function handleWelcome(msg: WelcomeMessage): void {
  console.log(
    `${timestamp()} ${c('cyan', '[WELCOME]')} ` +
      `serverId=${c('bold', msg.serverId)} ` +
      `version=${msg.serverVersion} ` +
      `protocol=${msg.protocolVersion}`,
  );
}

function handleState(msg: StateMessage): void {
  const { state } = msg;
  const totalTools = state.scopes.reduce((sum, s) => sum + s.tools.length, 0);
  const totalResources = state.scopes.reduce((sum, s) => sum + s.resources.length, 0);
  const totalPrompts = state.scopes.reduce((sum, s) => sum + s.prompts.length, 0);
  const totalAgents = state.scopes.reduce((sum, s) => sum + s.agents.length, 0);

  console.log(
    `${timestamp()} ${c('blue', '[STATE]')} ` +
      `${state.scopes.length} scopes, ` +
      `${totalTools} tools, ` +
      `${totalResources} resources, ` +
      `${totalPrompts} prompts, ` +
      `${totalAgents} agents, ` +
      `${state.sessions.length} sessions`,
  );

  // Log scope details
  for (const scope of state.scopes) {
    console.log(
      `${timestamp()}   ${c('dim', '└─')} Scope ${c('bold', scope.id)}: ` +
        `${scope.tools.length} tools, ${scope.resources.length} resources`,
    );
  }

  // Log server info
  console.log(`${timestamp()}   ${c('dim', '└─')} Server: ${c('bold', state.server.name)} v${state.server.version}`);
  console.log('');
}

function handleEvent(msg: EventMessage): void {
  const { event } = msg;
  const category = event.category;
  const eventType = event.type;

  // Color based on category
  let categoryColor: keyof typeof colors = 'gray';
  switch (category) {
    case 'session':
      categoryColor = 'magenta';
      break;
    case 'request':
      categoryColor = 'green';
      break;
    case 'registry':
      categoryColor = 'blue';
      break;
    case 'server':
      categoryColor = 'cyan';
      break;
    case 'log':
      categoryColor = eventType.includes('error') ? 'red' : eventType.includes('warn') ? 'yellow' : 'gray';
      break;
  }

  // Format event details
  let details = '';
  if (event.data) {
    const data = event.data;
    if (data.sessionId) details += ` sessionId=${data.sessionId}`;
    if (data.flowName) details += ` flow=${data.flowName}`;
    if (data.toolName) details += ` tool=${data.toolName}`;
    if (data.durationMs) details += ` ${data.durationMs}ms`;
    if (data.error) details += ` error=${JSON.stringify(data.error)}`;
    if (data.registryType) details += ` registry=${data.registryType}`;
    if (data.changeKind) details += ` kind=${data.changeKind}`;
    if (data.snapshotCount !== undefined) details += ` count=${data.snapshotCount}`;
    if (data.message) details += ` msg="${String(data.message).slice(0, 50)}"`;
  }

  console.log(
    `${timestamp()} ${c(categoryColor, `[${category.toUpperCase()}]`)} ` + `${c('bold', eventType)}${details}`,
  );
}

function handleResponse(msg: ResponseMessage): void {
  const status = msg.success ? c('green', 'OK') : c('red', 'FAIL');
  console.log(
    `${timestamp()} ${c('yellow', '[RESPONSE]')} ` +
      `commandId=${msg.commandId} ${status}` +
      (msg.error ? ` error=${msg.error.message}` : ''),
  );
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(`\n${timestamp()} ${c('yellow', '[SIGINT]')} Closing connection...`);
  socket.end();
});

console.log(c('dim', 'Press Ctrl+C to exit'));
console.log('');
