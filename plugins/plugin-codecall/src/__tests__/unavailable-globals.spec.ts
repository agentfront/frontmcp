describe('unavailableGlobals', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@enclave-vm/ast');
  });

  it('lists the globals the sandbox lacks', async () => {
    const { unavailableGlobals } = await import('../security/script-policy.js');

    expect(unavailableGlobals().map(({ name }) => name)).toEqual([
      'Set',
      'Map',
      'WeakMap',
      'WeakSet',
      'Symbol',
      'RegExp',
      'Promise',
      'Error',
      'TypeError',
      'RangeError',
      'structuredClone',
    ]);
  });

  it('leaves out a global once the sandbox provides it', async () => {
    jest.doMock('@enclave-vm/ast', () => {
      const actual = jest.requireActual('@enclave-vm/ast');
      return {
        ...actual,
        getAgentScriptGlobals: (level: string) => [...actual.getAgentScriptGlobals(level), 'Set', 'Map', 'Error'],
      };
    });
    const { unavailableGlobals, findScriptPolicyIssues } = await import('../security/script-policy.js');

    expect(unavailableGlobals().map(({ name }) => name)).toEqual([
      'WeakMap',
      'WeakSet',
      'Symbol',
      'RegExp',
      'Promise',
      'TypeError',
      'RangeError',
      'structuredClone',
    ]);
    const issues = await findScriptPolicyIssues("const ids = new Set(['a']);\nreturn ids.size;", {
      allowLoops: false,
      disabledBuiltins: [],
      disabledGlobals: [],
      allowConsole: false,
    });
    expect(issues).toEqual([]);
  });
});
