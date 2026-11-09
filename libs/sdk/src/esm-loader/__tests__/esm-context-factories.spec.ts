import {
  createEsmPromptContextClass,
  createEsmResourceContextClass,
  createEsmToolContextClass,
} from '../factories/esm-context-factories';

describe('esm-context-factories', () => {
  describe('createEsmToolContextClass()', () => {
    it('returns a class with the correct name', () => {
      const executeFn = jest.fn();
      const CtxClass = createEsmToolContextClass(executeFn, 'my-tool');
      expect(CtxClass.name).toBe('EsmTool_my-tool');
    });

    it('execute delegates to the provided function, with the context', async () => {
      const expectedResult = { content: [{ type: 'text', text: 'hello' }] };
      const executeFn = jest.fn().mockResolvedValue(expectedResult);

      const CtxClass = createEsmToolContextClass(executeFn, 'echo');

      // Access the prototype's execute method directly
      const proto = CtxClass.prototype;
      const result = await proto.execute({ message: 'hi' });

      expect(executeFn).toHaveBeenCalledWith({ message: 'hi' }, proto);
      expect(result).toEqual(expectedResult);
    });

    it('propagates errors from execute function', async () => {
      const executeFn = jest.fn().mockRejectedValue(new Error('tool failed'));
      const CtxClass = createEsmToolContextClass(executeFn, 'failing-tool');

      await expect(CtxClass.prototype.execute({})).rejects.toThrow('tool failed');
    });
  });

  describe('createEsmResourceContextClass()', () => {
    it('returns a class with the correct name', () => {
      const readFn = jest.fn();
      const CtxClass = createEsmResourceContextClass(readFn, 'my-resource');
      expect(CtxClass.name).toBe('EsmResource_my-resource');
    });

    it('execute delegates to the provided read function, with the context', async () => {
      const expectedResult = { contents: [{ uri: 'file://test', text: 'data' }] };
      const readFn = jest.fn().mockResolvedValue(expectedResult);

      const CtxClass = createEsmResourceContextClass(readFn, 'file-reader');
      const result = await CtxClass.prototype.execute('file://test', { key: 'val' });

      expect(readFn).toHaveBeenCalledWith('file://test', { key: 'val' }, CtxClass.prototype);
      expect(result).toEqual(expectedResult);
    });

    it('propagates errors from read function', async () => {
      const readFn = jest.fn().mockRejectedValue(new Error('read failed'));
      const CtxClass = createEsmResourceContextClass(readFn, 'failing-resource');

      await expect(CtxClass.prototype.execute('uri', {})).rejects.toThrow('read failed');
    });
  });

  describe('createEsmPromptContextClass()', () => {
    it('returns a class with the correct name', () => {
      const executeFn = jest.fn();
      const CtxClass = createEsmPromptContextClass(executeFn, 'my-prompt');
      expect(CtxClass.name).toBe('EsmPrompt_my-prompt');
    });

    it('execute delegates to the provided function, with the context', async () => {
      const expectedResult = {
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      };
      const executeFn = jest.fn().mockResolvedValue(expectedResult);

      const CtxClass = createEsmPromptContextClass(executeFn, 'greeter');
      const result = await CtxClass.prototype.execute({ name: 'world' });

      expect(executeFn).toHaveBeenCalledWith({ name: 'world' }, CtxClass.prototype);
      expect(result).toEqual(expectedResult);
    });

    it('propagates errors from execute function', async () => {
      const executeFn = jest.fn().mockRejectedValue(new Error('prompt failed'));
      const CtxClass = createEsmPromptContextClass(executeFn, 'failing-prompt');

      await expect(CtxClass.prototype.execute({})).rejects.toThrow('prompt failed');
    });
  });
});
