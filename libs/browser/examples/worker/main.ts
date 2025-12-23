/**
 * FrontMCP Browser - WebWorker Example
 *
 * This example demonstrates:
 * - Running MCP server in a WebWorker for off-main-thread processing
 * - MessagePort-based communication between main thread and worker
 * - Heavy computation tools that don't block the UI
 */

import { BrowserMcpServer, createMcpStore } from '@frontmcp/browser';

// =============================================================================
// Worker State
// =============================================================================

interface WorkerState {
  status: 'idle' | 'processing';
  lastResult: unknown;
  processedCount: number;
}

const store = createMcpStore<WorkerState>({
  initialState: {
    status: 'idle',
    lastResult: null,
    processedCount: 0,
  },
});

// =============================================================================
// Server Setup
// =============================================================================

const server = new BrowserMcpServer({
  name: 'worker-example',
  store,
});

// Heavy computation tool - fibonacci (intentionally slow for demo)
server.addTool({
  name: 'fibonacci',
  description: 'Calculate fibonacci number (CPU-intensive)',
  inputSchema: {
    type: 'object',
    properties: {
      n: { type: 'number', description: 'The fibonacci index to calculate' },
    },
    required: ['n'],
  },
  handler: async (args) => {
    store.state.status = 'processing';
    const n = args['n'] as number;

    // Recursive fibonacci (intentionally slow for large n)
    function fib(num: number): number {
      if (num <= 1) return num;
      return fib(num - 1) + fib(num - 2);
    }

    const result = fib(Math.min(n, 40)); // Cap at 40 for safety

    store.state.status = 'idle';
    store.state.lastResult = result;
    store.state.processedCount++;

    return { n, result };
  },
});

// Prime number check tool
server.addTool({
  name: 'is-prime',
  description: 'Check if a number is prime',
  inputSchema: {
    type: 'object',
    properties: {
      number: { type: 'number', description: 'Number to check' },
    },
    required: ['number'],
  },
  handler: async (args) => {
    store.state.status = 'processing';
    const num = args['number'] as number;

    function isPrime(n: number): boolean {
      if (n < 2) return false;
      if (n === 2) return true;
      if (n % 2 === 0) return false;
      for (let i = 3; i <= Math.sqrt(n); i += 2) {
        if (n % i === 0) return false;
      }
      return true;
    }

    const result = isPrime(num);

    store.state.status = 'idle';
    store.state.lastResult = result;
    store.state.processedCount++;

    return { number: num, isPrime: result };
  },
});

// Find primes in range tool
server.addTool({
  name: 'find-primes',
  description: 'Find all prime numbers in a range',
  inputSchema: {
    type: 'object',
    properties: {
      start: { type: 'number', description: 'Start of range' },
      end: { type: 'number', description: 'End of range' },
    },
    required: ['start', 'end'],
  },
  handler: async (args) => {
    store.state.status = 'processing';
    const start = args['start'] as number;
    const end = args['end'] as number;

    const primes: number[] = [];

    for (let n = Math.max(2, start); n <= Math.min(end, 100000); n++) {
      let isPrime = true;
      if (n > 2 && n % 2 === 0) {
        isPrime = false;
      } else {
        for (let i = 3; i <= Math.sqrt(n); i += 2) {
          if (n % i === 0) {
            isPrime = false;
            break;
          }
        }
      }
      if (isPrime) primes.push(n);
    }

    store.state.status = 'idle';
    store.state.lastResult = primes;
    store.state.processedCount++;

    return { start, end, count: primes.length, primes };
  },
});

// Factorization tool
server.addTool({
  name: 'factorize',
  description: 'Find prime factors of a number',
  inputSchema: {
    type: 'object',
    properties: {
      number: { type: 'number', description: 'Number to factorize' },
    },
    required: ['number'],
  },
  handler: async (args) => {
    store.state.status = 'processing';
    let num = args['number'] as number;

    const factors: number[] = [];
    let divisor = 2;

    while (num >= 2) {
      if (num % divisor === 0) {
        factors.push(divisor);
        num = num / divisor;
      } else {
        divisor++;
      }
    }

    store.state.status = 'idle';
    store.state.lastResult = factors;
    store.state.processedCount++;

    return { number: args['number'], factors };
  },
});

// Add resources
server.addResource({
  uri: 'worker://status',
  name: 'Worker Status',
  description: 'Current worker status and statistics',
  handler: async () => ({
    contents: [
      {
        uri: 'worker://status',
        mimeType: 'application/json',
        text: JSON.stringify(store.getSnapshot(), null, 2),
      },
    ],
  }),
});

// =============================================================================
// Worker Communication
// =============================================================================

// Start server
server.start().then(() => {
  self.postMessage({ type: 'ready' });
});

// Handle messages from main thread
self.onmessage = async (event: MessageEvent) => {
  const { type, id, tool, args, uri } = event.data;

  try {
    if (type === 'call-tool') {
      const result = await server.callTool(tool, args);
      self.postMessage({ type: 'tool-result', id, result });
    } else if (type === 'read-resource') {
      const result = await server.readResource(uri);
      self.postMessage({ type: 'resource-result', id, result });
    } else if (type === 'list-tools') {
      const tools = server.getTools();
      self.postMessage({ type: 'tools-list', id, tools });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
