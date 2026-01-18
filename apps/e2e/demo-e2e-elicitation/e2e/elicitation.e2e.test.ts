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
});
