describe('unavailableGlobals', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@enclave-vm/ast');
  });

  it('lists the globals the sandbox lacks', async () => {
    const { unavailableGlobals } = await import('../security/script-policy.js');

    expect(unavailableGlobals().map(({ name }) => name)).toEqual([
      'WeakMap',
      'WeakSet',
      'Symbol',
      'RegExp',
      'Promise',
      'structuredClone',
    ]);
  });

  it('leaves out a global once the sandbox provides it', async () => {
    jest.doMock('@enclave-vm/ast', () => {
      const actual = jest.requireActual('@enclave-vm/ast');
      return {
        ...actual,
        getAgentScriptGlobals: (level: string) => [...actual.getAgentScriptGlobals(level), 'WeakMap', 'Symbol'],
      };
    });
    const { unavailableGlobals, findScriptPolicyIssues } = await import('../security/script-policy.js');

    expect(unavailableGlobals().map(({ name }) => name)).toEqual(['WeakSet', 'RegExp', 'Promise', 'structuredClone']);
    const issues = await findScriptPolicyIssues('const cache = new WeakMap();\nreturn 1;', {
      allowLoops: false,
      disabledBuiltins: [],
      disabledGlobals: [],
      allowConsole: false,
    });
    expect(issues).toEqual([]);
  });
});
