/**
 * @file esm-fixtures.ts
 * @description In-memory bundle content strings for test fixtures.
 * These are served by LocalEsmServer and written to disk for import during E2E tests.
 *
 * Note: Uses CJS format (module.exports) for Jest compatibility.
 * In production, esm.sh serves actual ESM bundles. The CJS wrapper
 * tests the full pipeline (fetch → cache → normalize → execute) without
 * requiring --experimental-vm-modules in Jest.
 */

/**
 * Simple tools package v1 - one tool that echoes input.
 */
export const SIMPLE_TOOLS_V1 = `
module.exports = {
  default: {
    name: '@test/simple-tools',
    version: '1.0.0',
    tools: [{
      name: 'echo',
      description: 'Echoes input back',
      execute: async (input) => ({
        content: [{ type: 'text', text: JSON.stringify(input) }],
      }),
    }],
  },
};
`;

/**
 * Simple tools package v2 - two tools (echo + reverse).
 */
export const SIMPLE_TOOLS_V2 = `
module.exports = {
  default: {
    name: '@test/simple-tools',
    version: '2.0.0',
    tools: [
      {
        name: 'echo',
        description: 'Echoes input back',
        execute: async (input) => ({
          content: [{ type: 'text', text: JSON.stringify(input) }],
        }),
      },
      {
        name: 'reverse',
        description: 'Reverses input text',
        execute: async (input) => ({
          content: [{ type: 'text', text: String(input.text || '').split('').reverse().join('') }],
        }),
      },
    ],
  },
};
`;

/**
 * Multi-primitive package with tools + prompts + resources.
 */
export const MULTI_PRIMITIVE = `
module.exports = {
  default: {
    name: '@test/multi-primitive',
    version: '1.0.0',
    tools: [{
      name: 'greet',
      description: 'Greets a user',
      execute: async (input) => ({
        content: [{ type: 'text', text: 'Hello, ' + (input.name || 'world') + '!' }],
      }),
    }],
    prompts: [{
      name: 'greeting-prompt',
      description: 'A greeting prompt',
      arguments: [{ name: 'name', description: 'Name to greet', required: true }],
      execute: async (args) => ({
        messages: [{ role: 'user', content: { type: 'text', text: 'Greet ' + args.name } }],
      }),
    }],
    resources: [{
      name: 'status',
      description: 'Server status resource',
      uri: 'status://server',
      mimeType: 'application/json',
      read: async () => ({
        contents: [{ uri: 'status://server', text: JSON.stringify({ status: 'ok' }) }],
      }),
    }],
  },
};
`;

/**
 * Named exports package (simulates a module with named exports).
 */
export const NAMED_EXPORTS = `
module.exports = {
  name: '@test/named-exports',
  version: '1.0.0',
  tools: [{
    name: 'ping',
    description: 'Pings the server',
    execute: async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }),
  }],
};
`;
