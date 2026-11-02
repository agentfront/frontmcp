import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../../../errors';
import { FrontMcp } from '../../../decorators/front-mcp.decorator';
import { outputPolicySchema, resolveOutputBudget } from '../../../metadata/output-policy';
import { clientProfilesOptionsSchema } from '../clients';

function bootWith(options: Record<string, unknown>): () => void {
  return () =>
    FrontMcp({ info: { name: 'shaping', version: '1.0.0' }, apps: [], serve: false, ...options } as never)(
      class Server {},
    );
}

describe('answer shaping options', () => {
  describe('output.budget', () => {
    it('accepts a budget and false', () => {
      expect(outputPolicySchema.parse({ budget: { maxBytes: 4096, lists: 'keep-oldest' } }).budget).toEqual({
        maxBytes: 4096,
        lists: 'keep-oldest',
      });
      expect(outputPolicySchema.parse({ budget: false }).budget).toBe(false);
    });

    it.each([[{ maxBytes: 100 }], [{ maxBytes: 2048.5 }], [{ maxBytes: 4096, lists: 'newest' }], [{ max: 4096 }]])(
      'refuses %j',
      (budget) => {
        expect(outputPolicySchema.safeParse({ budget }).success).toBe(false);
      },
    );

    it('fails @FrontMcp at boot with a message naming maxBytes', () => {
      const boot = bootWith({ output: { budget: { maxBytes: 10 } } });
      expect(boot).toThrow(InvalidDecoratorMetadataError);
      expect(boot).toThrow(/output[\s\S]*at least 1024/);
    });

    it('resolves tool, then app, then server, and false turns a wider budget off', () => {
      const server = { budget: { maxBytes: 8192 } };
      expect(resolveOutputBudget(undefined, undefined, server)).toEqual({ maxBytes: 8192 });
      expect(resolveOutputBudget(undefined, { budget: { maxBytes: 2048 } }, server)).toEqual({ maxBytes: 2048 });
      expect(resolveOutputBudget({ budget: false }, { budget: { maxBytes: 2048 } }, server)).toBeUndefined();
      expect(resolveOutputBudget()).toBeUndefined();
    });
  });

  describe('clients', () => {
    it('accepts profiles keyed by client name globs', () => {
      const profiles = {
        'codex*': { structured: 'text' },
        'claude-code': { structured: 'only', annotations: 'no-numbers', instructions: 'compact' },
      };
      expect(clientProfilesOptionsSchema.parse(profiles)).toEqual(profiles);
    });

    it.each([
      [{ codex: { structured: 'json' } }],
      [{ codex: { structure: 'text' } }],
      [{ codex: { annotations: 'none' } }],
      [{ '': { structured: 'text' } }],
    ])('refuses %j', (profiles) => {
      expect(clientProfilesOptionsSchema.safeParse(profiles).success).toBe(false);
    });

    it('fails @FrontMcp at boot', () => {
      const boot = bootWith({ clients: { codex: { structured: 'json' } } });
      expect(boot).toThrow(InvalidDecoratorMetadataError);
      expect(boot).toThrow(/clients/);
    });
  });

  describe('http.forwardHeaders', () => {
    it('fails @FrontMcp at boot for authorization', () => {
      const boot = bootWith({ http: { forwardHeaders: ['x-acme-*', 'authorization'] } });
      expect(boot).toThrow(InvalidDecoratorMetadataError);
      expect(boot).toThrow(
        /"http"[\s\S]*never forwards authorization, cookie, proxy-\*, hop-by-hop, content-length or client-address/,
      );
    });
  });
});
