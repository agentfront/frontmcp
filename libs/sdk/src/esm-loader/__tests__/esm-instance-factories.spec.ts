import { z } from 'zod';
import { createEsmToolInstance } from '../factories/esm-instance-factories';
import { createMockOwner, createMockProviderRegistry } from '../../__test-utils__/mocks';
import type { ToolCallExtra } from '../../common/entries/tool.entry';

describe('esm-instance-factories', () => {
  describe('createEsmToolInstance()', () => {
    it('preserves JSON Schema tool arguments when parsing input', async () => {
      const execute = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      const instance = createEsmToolInstance(
        {
          name: 'echo',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          execute,
        },
        createMockProviderRegistry(),
        createMockOwner(),
        'esm',
      );

      await instance.ready;

      const parsed = instance.parseInput({
        name: 'esm:echo',
        arguments: { message: 'hello' },
      });

      expect(parsed).toEqual({ message: 'hello' });

      const ctx = instance.create(parsed, { authInfo: {} } as ToolCallExtra);
      await ctx.execute(ctx.input);

      expect(execute).toHaveBeenCalledWith({ message: 'hello' });
    });

    it('keeps strict parsing for Zod-shape ESM tools', async () => {
      const instance = createEsmToolInstance(
        {
          name: 'strict-echo',
          inputSchema: {
            message: z.string(),
          } as Record<string, unknown>,
          execute: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'ok' }],
          }),
        },
        createMockProviderRegistry(),
        createMockOwner(),
        'esm',
      );

      await instance.ready;

      const parsed = instance.parseInput({
        name: 'esm:strict-echo',
        arguments: { message: 'hello', extra: 'ignored' },
      });

      expect(parsed).toEqual({ message: 'hello' });
    });
  });
});
