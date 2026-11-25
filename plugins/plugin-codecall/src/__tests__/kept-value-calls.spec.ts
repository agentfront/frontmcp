import type { ResultOwner } from '@frontmcp/plugin-result-handles';
import type { FrontMcpLogger } from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { KeptValueCalls } from '../kept-values/kept-value-calls';
import { KeptValueStore } from '../kept-values/kept-value.store';

const alice: ResultOwner = { session: 'session-1', caller: 'alice' };
const TOKEN = /^__REF_[0-9a-f-]{36}__$/;

async function memoryStore(maxBytes = 1024 * 1024): Promise<KeptValueStore> {
  const root = createMemoryStorage();
  await root.connect();
  return new KeptValueStore(root.namespace('codecall-kept'), { ttlSeconds: 60, maxBytes });
}

describe('KeptValueCalls', () => {
  let store: KeptValueStore;

  beforeEach(async () => {
    store = await memoryStore();
  });

  it('keeps a value, then recalls it as it was kept', async () => {
    const calls = new KeptValueCalls({ store, owner: alice });

    expect(await calls.call('codecall:keep', { name: 'overdue', value: [{ id: 1 }] })).toBeUndefined();
    expect(await calls.call('codecall:recall', { name: 'overdue' })).toEqual([{ id: 1 }]);
    expect(await calls.call('codecall:recall', { name: 'never-kept' })).toBeUndefined();
  });

  it.each(['codecall:keep', 'codecall:recall'])(
    'refuses %s for a call with no session and no signed-in caller',
    async (callName) => {
      const calls = new KeptValueCalls({ store, owner: {} });

      await expect(calls.call(callName, { name: 'overdue', value: 1 })).rejects.toEqual({
        code: 'ACCESS_DENIED',
        toolName: callName,
        message: 'keep and recall need a session or a signed-in caller to keep values for, and this call has neither',
      });
    },
  );

  it.each([
    ['no name', {}],
    ['an empty name', { name: '' }],
    ['a name that is not a string', { name: 42 }],
    ['a name over 128 characters', { name: 'n'.repeat(129) }],
  ])('refuses %s', async (_, args) => {
    const calls = new KeptValueCalls({ store, owner: alice });

    await expect(calls.call('codecall:recall', args)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'The name must be a string of 1 to 128 characters',
    });
  });

  it('refuses to keep undefined, and keeps null', async () => {
    const calls = new KeptValueCalls({ store, owner: alice });

    await expect(calls.call('codecall:keep', { name: 'nothing' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await calls.call('codecall:keep', { name: 'empty', value: null });
    expect(await calls.call('codecall:recall', { name: 'empty' })).toBeNull();
  });

  it('refuses a value past keep.maxBytes as too large, with what it would take', async () => {
    const calls = new KeptValueCalls({ store: await memoryStore(1024), owner: alice });

    await expect(calls.call('codecall:keep', { name: 'big', value: 'x'.repeat(2048) })).rejects.toMatchObject({
      code: 'RESULT_TOO_LARGE',
      toolName: 'codecall:keep',
      message: expect.stringContaining('over the 1024-byte limit'),
    });
  });

  it('logs a store that fails, and tells the script only that the call failed', async () => {
    const warn = jest.fn();
    jest.spyOn(store, 'recall').mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:6379'));
    const calls = new KeptValueCalls({ store, owner: alice, logger: { warn } as unknown as FrontMcpLogger });

    const failure = await calls.call('codecall:recall', { name: 'overdue' }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'EXECUTION', toolName: 'codecall:recall' });
    expect(JSON.stringify(failure)).not.toContain('ECONNREFUSED');
    expect(warn).toHaveBeenCalledWith('codecall: the kept-value store failed', {
      error: 'connect ECONNREFUSED 10.0.0.5:6379',
    });
  });

  describe('with the sidecar', () => {
    const large = 'x'.repeat(4096);

    it('keeps a large string as a sidecar entry, which a later run recalling it by name starts with', async () => {
      const first = new KeptValueCalls({ store, owner: alice, referenceThreshold: 1024 });
      await first.call('codecall:keep', { name: 'doc', value: large });
      await first.call('codecall:keep', { name: 'note', value: 'short' });

      const second = new KeptValueCalls({ store, owner: alice, referenceThreshold: 1024 });
      const { script, preloadReferences } = await second.prepare("return [await recall('doc'), await recall('note')];");

      expect(script).toContain("const recall = (name) => callTool('codecall:recall', { name });");
      expect(preloadReferences).toEqual([
        { id: expect.stringMatching(TOKEN), data: large, source: 'tool-result', origin: 'codecall:keep' },
      ]);
      expect(await second.call('codecall:recall', { name: 'doc' })).toBe(preloadReferences[0].id);
      expect(await second.call('codecall:recall', { name: 'note' })).toBe('short');
    });

    it('recalls a large string its run did not start with as the string, for the sidecar to keep out of the sandbox', async () => {
      const calls = new KeptValueCalls({ store, owner: alice, referenceThreshold: 1024 });
      await calls.call('codecall:keep', { name: 'doc', value: large });

      expect(await calls.call('codecall:recall', { name: 'doc' })).toBe(large);
    });

    it('starts a run with nothing when the store fails, and logs it', async () => {
      const warn = jest.fn();
      jest.spyOn(store, 'referencesOf').mockRejectedValue(new Error('down'));
      const calls = new KeptValueCalls({
        store,
        owner: alice,
        referenceThreshold: 1024,
        logger: { warn } as unknown as FrontMcpLogger,
      });

      expect((await calls.prepare("return await recall('doc');")).preloadReferences).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it('starts a run with nothing while the sidecar is off', async () => {
    const calls = new KeptValueCalls({ store, owner: alice });
    await calls.call('codecall:keep', { name: 'doc', value: 'x'.repeat(4096) });

    expect((await calls.prepare("return await recall('doc');")).preloadReferences).toEqual([]);
    expect(await calls.call('codecall:recall', { name: 'doc' })).toBe('x'.repeat(4096));
  });
});
