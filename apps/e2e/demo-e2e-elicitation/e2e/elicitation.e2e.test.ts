/**
 * E2E Tests for Elicitation Feature
 *
 * Tests the MCP elicitation feature that allows tools to request
 * interactive user input during execution.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Elicitation E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-elicitation/src/main.ts',
    publicMode: true,
  });

  test.describe('confirm-action tool', () => {
    test('should handle accepted confirmation', async ({ mcp }) => {
      // Setup: respond with confirmed=true
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { confirmed: true },
      }));

      const result = await mcp.tools.call('confirm-action', {
        action: 'delete file',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('confirmed and executed');
    });

    test('should handle declined confirmation', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { confirmed: false },
      }));

      const result = await mcp.tools.call('confirm-action', {
        action: 'delete file',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('was cancelled');
    });

    test('should handle cancel action', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'cancel',
      }));

      const result = await mcp.tools.call('confirm-action', {
        action: 'delete file',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('was cancelled');
    });

    test('should handle decline action', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'decline',
      }));

      const result = await mcp.tools.call('confirm-action', {
        action: 'delete file',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('was cancelled');
    });
  });

  test.describe('get-user-input tool', () => {
    test('should capture user input', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { userInput: 'Hello from test!' },
      }));

      const result = await mcp.tools.call('get-user-input', {
        prompt: 'Enter a message',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('Hello from test!');
    });

    test('should handle decline', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'decline',
      }));

      const result = await mcp.tools.call('get-user-input', {
        prompt: 'Enter a message',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('declined to provide input');
    });

    test('should handle empty input', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'accept',
        content: { userInput: '' },
      }));

      const result = await mcp.tools.call('get-user-input', {
        prompt: 'Enter a message',
      });

      expect(result).toBeSuccessful();
      // Empty string is falsy, so should be treated as declined
      expect(result.text()).toContain('declined to provide input');
    });
  });

  test.describe('multi-step-wizard tool', () => {
    test('should complete all steps', async ({ mcp }) => {
      let step = 0;
      mcp.onElicitation(async () => {
        step++;
        if (step === 1) {
          return { action: 'accept', content: { name: 'Alice' } };
        }
        return { action: 'accept', content: { color: 'blue' } };
      });

      const result = await mcp.tools.call('multi-step-wizard', {});

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('Welcome Alice');
      expect(result.text()).toContain('blue');
    });

    test('should handle cancellation at step 1', async ({ mcp }) => {
      mcp.onElicitation(async () => ({
        action: 'cancel',
      }));

      const result = await mcp.tools.call('multi-step-wizard', {});

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('cancelled at step 1');
    });

    test('should handle cancellation at step 2', async ({ mcp }) => {
      let step = 0;
      mcp.onElicitation(async () => {
        step++;
        if (step === 1) {
          return { action: 'accept', content: { name: 'Bob' } };
        }
        return { action: 'cancel' };
      });

      const result = await mcp.tools.call('multi-step-wizard', {});

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('cancelled at step 2');
    });

    test('should handle different colors', async ({ mcp }) => {
      let step = 0;
      mcp.onElicitation(async () => {
        step++;
        if (step === 1) {
          return { action: 'accept', content: { name: 'Charlie' } };
        }
        return { action: 'accept', content: { color: 'red' } };
      });

      const result = await mcp.tools.call('multi-step-wizard', {});

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('Welcome Charlie');
      expect(result.text()).toContain('red');
    });
  });

  test.describe('elicitation handler behavior', () => {
    test('should handle conditional responses based on message', async ({ mcp }) => {
      mcp.onElicitation(async (request) => {
        // Check the message to decide response
        if (request.message.includes('delete')) {
          return { action: 'decline' };
        }
        return { action: 'accept', content: { confirmed: true } };
      });

      // This should be declined because message contains "delete"
      const result = await mcp.tools.call('confirm-action', {
        action: 'delete important file',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('was cancelled');
    });

    test('should handle async handler operations', async ({ mcp }) => {
      mcp.onElicitation(async () => {
        // Simulate async operation (e.g., external validation)
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { action: 'accept', content: { confirmed: true } };
      });

      const result = await mcp.tools.call('confirm-action', {
        action: 'async operation',
      });

      expect(result).toBeSuccessful();
      expect(result.text()).toContain('confirmed and executed');
    });
  });

  /**
   * Tests for non-supporting MCP clients (e.g., OpenAI).
   *
   * When a client doesn't advertise elicitation capabilities, the server uses
   * a fallback mechanism: it returns structured instructions to the LLM,
   * and the LLM can call the `sendElicitationResult` tool to continue.
   */
  test.describe('non-supporting client fallback', () => {
    test('should include sendElicitationResult tool for non-supporting clients', async ({ server }) => {
      // Create a client without elicitation capabilities
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        const tools = await noElicitClient.tools.list();
        const toolNames = tools.map((t) => t.name);

        // sendElicitationResult should be included for non-supporting clients
        expect(toolNames).toContain('sendElicitationResult');
      } finally {
        await noElicitClient.disconnect();
      }
    });

    test('should NOT include sendElicitationResult tool for supporting clients', async ({ mcp }) => {
      // Default mcp client supports elicitation
      const tools = await mcp.tools.list();
      const toolNames = tools.map((t) => t.name);

      // sendElicitationResult should NOT be included for supporting clients
      expect(toolNames).not.toContain('sendElicitationResult');
    });

    test('should return fallback instructions when tool uses elicit()', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        // Call a tool that uses elicit()
        const result = await noElicitClient.tools.call('get-user-input', {
          prompt: 'Enter your name',
        });

        // Should be successful (not an error)
        expect(result).toBeSuccessful();

        // Check the text content contains fallback instructions
        const text = result.text();
        expect(text).toContain('requires user input');
        expect(text).toContain('sendElicitationResult');
        expect(text).toContain('elicitId');

        // Check _meta contains elicitationPending
        const meta = result.raw._meta as Record<string, unknown> | undefined;
        expect(meta).toBeDefined();
        expect(meta?.elicitationPending).toBeDefined();

        const pending = meta?.elicitationPending as {
          elicitId: string;
          message: string;
          schema: Record<string, unknown>;
          instructions: string;
        };
        expect(pending.elicitId).toBeDefined();
        expect(pending.message).toBeDefined();
        expect(pending.schema).toBeDefined();
        expect(pending.instructions).toContain('sendElicitationResult');
      } finally {
        await noElicitClient.disconnect();
      }
    });

    test('should complete fallback flow with sendElicitationResult', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        // Step 1: Call tool that uses elicit() - get fallback instructions
        const fallbackResult = await noElicitClient.tools.call('get-user-input', {
          prompt: 'Enter a greeting',
        });

        expect(fallbackResult).toBeSuccessful();

        // Extract elicitId from _meta
        const meta = fallbackResult.raw._meta as Record<string, unknown>;
        const pending = meta?.elicitationPending as { elicitId: string };
        const elicitId = pending?.elicitId;
        expect(elicitId).toBeDefined();

        // Step 2: Call sendElicitationResult with user's response
        const finalResult = await noElicitClient.tools.call('sendElicitationResult', {
          elicitId,
          action: 'accept',
          content: { userInput: 'Hello from fallback test!' },
        });

        // Step 3: Verify the original tool completed successfully
        expect(finalResult).toBeSuccessful();
        expect(finalResult.text()).toContain('Hello from fallback test!');
      } finally {
        await noElicitClient.disconnect();
      }
    });

    test('should handle cancel action in fallback flow', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        // Step 1: Call tool that uses elicit()
        const fallbackResult = await noElicitClient.tools.call('confirm-action', {
          action: 'delete file',
        });

        const meta = fallbackResult.raw._meta as Record<string, unknown>;
        const pending = meta?.elicitationPending as { elicitId: string };
        const elicitId = pending?.elicitId;

        // Step 2: Call sendElicitationResult with cancel action
        const finalResult = await noElicitClient.tools.call('sendElicitationResult', {
          elicitId,
          action: 'cancel',
        });

        // Step 3: Verify the tool handled cancellation
        expect(finalResult).toBeSuccessful();
        expect(finalResult.text()).toContain('was cancelled');
      } finally {
        await noElicitClient.disconnect();
      }
    });

    test('should handle decline action in fallback flow', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        // Step 1: Call tool that uses elicit()
        const fallbackResult = await noElicitClient.tools.call('get-user-input', {
          prompt: 'Enter something',
        });

        const meta = fallbackResult.raw._meta as Record<string, unknown>;
        const pending = meta?.elicitationPending as { elicitId: string };
        const elicitId = pending?.elicitId;

        // Step 2: Call sendElicitationResult with decline action
        const finalResult = await noElicitClient.tools.call('sendElicitationResult', {
          elicitId,
          action: 'decline',
        });

        // Step 3: Verify the tool handled decline
        expect(finalResult).toBeSuccessful();
        expect(finalResult.text()).toContain('declined to provide input');
      } finally {
        await noElicitClient.disconnect();
      }
    });

    test('should return error for invalid elicitId', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        // Call sendElicitationResult with non-existent elicitId
        const result = await noElicitClient.tools.call('sendElicitationResult', {
          elicitId: 'non-existent-id',
          action: 'accept',
          content: { userInput: 'test' },
        });

        // Should return an error
        expect(result.isError).toBe(true);
        expect(result.text()).toContain('No pending elicitation found');
      } finally {
        await noElicitClient.disconnect();
      }
    });

    test('should work with confirm-action tool in fallback flow', async ({ server }) => {
      const noElicitClient = await server
        .createClientBuilder()
        .withCapabilities({}) // No elicitation support
        .withPublicMode()
        .buildAndConnect();

      try {
        // Step 1: Call confirm-action tool
        const fallbackResult = await noElicitClient.tools.call('confirm-action', {
          action: 'send email',
        });

        const meta = fallbackResult.raw._meta as Record<string, unknown>;
        const pending = meta?.elicitationPending as { elicitId: string };
        const elicitId = pending?.elicitId;

        // Step 2: Confirm the action
        const finalResult = await noElicitClient.tools.call('sendElicitationResult', {
          elicitId,
          action: 'accept',
          content: { confirmed: true },
        });

        // Step 3: Verify confirmation was processed
        expect(finalResult).toBeSuccessful();
        expect(finalResult.text()).toContain('confirmed and executed');
      } finally {
        await noElicitClient.disconnect();
      }
    });
  });
});
