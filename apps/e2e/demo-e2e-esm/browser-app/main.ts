/**
 * @file main.ts
 * @description Full FrontMCP instance running in the browser with dynamic ESM tool loading.
 *
 * This is the browser entry point for the ESM E2E test. It boots a real FrontMCP
 * DirectClient (no HTTP server) that loads ESM tool packages on the fly from
 * a local ESM package server.
 *
 * Playwright tests read results from window.__ESM_RESULTS__ after the page loads.
 */
import 'reflect-metadata';
import { connect, loadFrom, LogLevel } from '@frontmcp/sdk';

// Read ESM server URL from query params (set by Playwright test)
const params = new URLSearchParams(location.search);
const esmServerUrl = params.get('esmServer') ?? 'http://127.0.0.1:50413';

interface EsmTestResults {
  success: boolean;
  toolNames?: string[];
  echoResult?: unknown;
  addResult?: unknown;
  greetResult?: unknown;
  resourceUris?: string[];
  promptNames?: string[];
  error?: string;
}

declare global {
  interface Window {
    __ESM_RESULTS__?: EsmTestResults;
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;

  try {
    app.textContent = 'Connecting to FrontMCP...';

    // Boot a FULL FrontMCP instance in the browser via DirectClient
    const client = await connect(
      {
        info: { name: 'Browser ESM E2E', version: '0.1.0' },
        loader: { url: esmServerUrl },
        apps: [
          loadFrom('@test/esm-tools@^1.0.0', { namespace: 'esm' }),
          loadFrom('@test/esm-multi@^1.0.0', { namespace: 'multi' }),
        ],
        logging: { level: LogLevel.Warn },
      },
      { mode: 'cli' },
    );

    app.textContent = 'Loading tools...';

    // List tools
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);

    // Call tools
    const echoResult = await client.callTool({
      name: 'esm:echo',
      arguments: { message: 'browser-hello' },
    });

    const addResult = await client.callTool({
      name: 'esm:add',
      arguments: { a: 5, b: 7 },
    });

    const greetResult = await client.callTool({
      name: 'multi:greet',
      arguments: { name: 'Browser' },
    });

    // List resources
    const { resources } = await client.listResources();
    const resourceUris = resources.map((r) => r.uri);

    // List prompts
    const { prompts } = await client.listPrompts();
    const promptNames = prompts.map((p) => p.name);

    // Report results
    const results: EsmTestResults = {
      success: true,
      toolNames,
      echoResult,
      addResult,
      greetResult,
      resourceUris,
      promptNames,
    };

    window.__ESM_RESULTS__ = results;
    app.textContent = JSON.stringify(results, null, 2);
  } catch (err) {
    const results: EsmTestResults = {
      success: false,
      error: (err as Error).message + '\n' + (err as Error).stack,
    };
    window.__ESM_RESULTS__ = results;
    app.textContent = 'Error: ' + (err as Error).message;
    console.error('FrontMCP browser ESM error:', err);
  }
}

main();
