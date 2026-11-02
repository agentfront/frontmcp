import * as path from 'path';

import * as ts from 'typescript';

const workspaceRoot = path.resolve(__dirname, '../../../..');
const fixtureDir = path.resolve(__dirname, '../fixture');
const sdkDeclarationsOverride = process.env['FRONTMCP_SDK_DTS_DIR'];
const sdkDeclarationsDir = path.resolve(sdkDeclarationsOverride ?? path.join(workspaceRoot, 'libs/sdk/dist'));

interface FixtureDiagnostic {
  fileName: string;
  location: string;
  summary: string;
}

function toFixtureDiagnostic(diagnostic: ts.Diagnostic): FixtureDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0];
  const summary = `TS${diagnostic.code}: ${message}`;
  if (!diagnostic.file || diagnostic.start === undefined) {
    return { fileName: '', location: '', summary };
  }
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const fileName = path.resolve(diagnostic.file.fileName);
  return { fileName, location: `${path.relative(workspaceRoot, fileName)}:${line + 1}`, summary };
}

const fixtureFiles = [
  'provider-lifecycle-must-compile.ts',
  'sqlite-storage-must-compile.ts',
  'process-kit-must-compile.ts',
  'tool-must-fail.ts',
  'prompts-must-compile.ts',
  'hooks-must-compile.ts',
  'hooks-must-fail.ts',
  'host-must-compile.ts',
  'skills-must-compile.ts',
  'output-schemas-must-compile.ts',
  'providers-must-compile.ts',
  'tool-aliases-must-compile.ts',
  'answer-shaping-must-compile.ts',
  'call-recorder-must-compile.ts',
  'hook-ordering-must-compile.ts',
  'hook-ordering-must-fail.ts',
  'live-surface-must-compile.ts',
  'materialized-resources-must-compile.ts',
].map((fileName) => path.join(fixtureDir, fileName));

function compileFixture(withoutExpectErrors?: string): { diagnostics: FixtureDiagnostic[]; sourceFiles: string[] } {
  const sdkPathOverride = sdkDeclarationsOverride
    ? { paths: { '@frontmcp/sdk': [path.join(sdkDeclarationsDir, 'index.d.ts')] } }
    : {};
  const parsedConfig = ts.getParsedCommandLineOfConfigFile(path.join(fixtureDir, 'tsconfig.json'), sdkPathOverride, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!parsedConfig) {
    throw new Error(`Unable to read ${path.join(fixtureDir, 'tsconfig.json')}`);
  }
  const host = ts.createCompilerHost(parsedConfig.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    path.resolve(fileName) === withoutExpectErrors
      ? ts.createSourceFile(fileName, withoutExpectErrorsText(fileName), languageVersion)
      : getSourceFile(fileName, languageVersion, ...rest);
  const program = ts.createProgram({ rootNames: parsedConfig.fileNames, options: parsedConfig.options, host });
  return {
    diagnostics: [...parsedConfig.errors, ...ts.getPreEmitDiagnostics(program)].map(toFixtureDiagnostic),
    sourceFiles: program.getSourceFiles().map((sourceFile) => path.resolve(sourceFile.fileName)),
  };
}

function withoutExpectErrorsText(fileName: string): string {
  return (ts.sys.readFile(fileName) ?? '').replaceAll('// @ts-expect-error', '// expected:');
}

function describeEach(diagnostics: FixtureDiagnostic[]): string[] {
  return diagnostics.map(({ location, summary }) => `${location} ${summary}`);
}

function groupBySummary(diagnostics: FixtureDiagnostic[]): string[] {
  const locationsBySummary = new Map<string, string[]>();
  for (const { location, summary } of diagnostics) {
    locationsBySummary.set(summary, [...(locationsBySummary.get(summary) ?? []), location]);
  }
  return [...locationsBySummary].map(
    ([summary, locations]) => `${locations.length} x ${summary} (e.g. ${locations[0]})`,
  );
}

describe('@frontmcp/sdk declarations in a strict consumer project', () => {
  let diagnostics: FixtureDiagnostic[];
  let sourceFiles: string[];

  beforeAll(() => {
    ({ diagnostics, sourceFiles } = compileFixture());
  });

  it('compiles every fixture file, with no diagnostic outside a file', () => {
    expect(sourceFiles).toEqual(expect.arrayContaining(fixtureFiles));
    expect(describeEach(diagnostics.filter((diagnostic) => diagnostic.fileName === ''))).toEqual([]);
  });

  const inFixtureFile = (fileName: string) =>
    diagnostics.filter((diagnostic) => diagnostic.fileName === path.join(fixtureDir, fileName));

  it('types @Tool and @Agent so every invalid @Tool declaration is rejected', () => {
    expect(describeEach(inFixtureFile('tool-must-fail.ts'))).toEqual([]);
  });

  it('types the provider lifecycle hooks, the lifecycle option and createContainer()', () => {
    expect(describeEach(inFixtureFile('provider-lifecycle-must-compile.ts'))).toEqual([]);
  });

  it('types sqliteStorageProvider() and the storage SqliteStorageToken resolves to', () => {
    expect(describeEach(inFixtureFile('sqlite-storage-must-compile.ts'))).toEqual([]);
  });

  it('types the process kit and lifecycle.exitWhenOrphaned', () => {
    expect(describeEach(inFixtureFile('process-kit-must-compile.ts'))).toEqual([]);
  });

  it('accepts the documented @Prompt forms', () => {
    expect(describeEach(inFixtureFile('prompts-must-compile.ts'))).toEqual([]);
  });

  it('types the prompt, completion and Finally hooks, the hook ctx accessors, the scope channel accessors and server-level adapters', () => {
    expect(describeEach(inFixtureFile('hooks-must-compile.ts'))).toEqual([]);
  });

  it('rejects a hook whose parameter the flow ctx does not satisfy, for every hook decorator', () => {
    expect(describeEach(inFixtureFile('hooks-must-fail.ts'))).toEqual([]);
  });

  it('fails each hooks-must-fail.ts case with TS1241 once its @ts-expect-error is removed', () => {
    const mustFail = path.join(fixtureDir, 'hooks-must-fail.ts');
    const expectedFailures = (ts.sys.readFile(mustFail) ?? '')
      .split('\n')
      .flatMap((line, index) => (line.includes('// @ts-expect-error') ? [index + 2] : []))
      .map(
        (line) =>
          `${path.relative(workspaceRoot, mustFail)}:${line} TS1241: Unable to resolve signature of method decorator when called as an expression.`,
      );
    const failures = compileFixture(mustFail).diagnostics.filter((diagnostic) => diagnostic.fileName === mustFail);

    expect(expectedFailures.length).toBeGreaterThan(10);
    expect(describeEach(failures)).toEqual(expectedFailures);
  });

  it('types a custom host without enhancedHandler, and names Scope for the web-fetch helpers (#819)', () => {
    expect(describeEach(inFixtureFile('host-must-compile.ts'))).toEqual([]);
  });

  it('types this.scope.skills.setExternalProvider(), skillsConfig.externalProvider and its instructions and annotation policies', () => {
    expect(describeEach(inFixtureFile('skills-must-compile.ts'))).toEqual([]);
  });

  it('types a z.union() or z.discriminatedUnion() outputSchema with no cast, and output.undeclaredKeys', () => {
    expect(describeEach(inFixtureFile('output-schemas-must-compile.ts'))).toEqual([]);
  });

  it('types providers without a name, AsyncProvider with and without inject, useValue and symbol or string tokens in every entry point', () => {
    expect(describeEach(inFixtureFile('providers-must-compile.ts'))).toEqual([]);
  });

  it('types @Tool({ aliases }), refused() and a PublicMcpError remedy', () => {
    expect(describeEach(inFixtureFile('tool-aliases-must-compile.ts'))).toEqual([]);
  });

  it('types output.budget, clients profiles, http.forwardHeaders, the budget note and isClientCall() on the call-tool hook ctx', () => {
    expect(describeEach(inFixtureFile('answer-shaping-must-compile.ts'))).toEqual([]);
  });

  it('types CallRecorderPlugin.init() options, on an app and on the server, and the CallRecord lines', () => {
    expect(describeEach(inFixtureFile('call-recorder-must-compile.ts'))).toEqual([]);
  });

  it('types HookPhase, before / after, appliesTo: all-apps, the hook observers, the hook trace and devtools', () => {
    expect(describeEach(inFixtureFile('hook-ordering-must-compile.ts'))).toEqual([]);
  });

  it('rejects an appliesTo, before or after the SDK cannot apply, and a write to HookPhase', () => {
    expect(describeEach(inFixtureFile('hook-ordering-must-fail.ts'))).toEqual([]);
  });

  it('fails each hook-ordering-must-fail.ts case once its @ts-expect-error is removed', () => {
    const mustFail = path.join(fixtureDir, 'hook-ordering-must-fail.ts');
    const expectedLines = (ts.sys.readFile(mustFail) ?? '')
      .split('\n')
      .flatMap((line, index) => (line.includes('// @ts-expect-error') ? [index + 2] : []));
    const failures = compileFixture(mustFail).diagnostics.filter((diagnostic) => diagnostic.fileName === mustFail);

    expect(expectedLines).toHaveLength(4);
    expect([...new Set(failures.map(({ location }) => Number(location.split(':').pop())))]).toEqual(expectedLines);
  });

  it('types enabled as a boolean or an EnabledSource such as fileSignal(), and the surface key', () => {
    expect(describeEach(inFixtureFile('live-surface-must-compile.ts'))).toEqual([]);
  });

  it('types resourceStore(), its keys and snapshots, @Resource({ from }) and MaterializedResourceContext', () => {
    expect(describeEach(inFixtureFile('materialized-resources-must-compile.ts'))).toEqual([]);
  });

  it('ships declaration files that type-check with skipLibCheck disabled', () => {
    const sdkDeclarationDiagnostics = diagnostics.filter((diagnostic) =>
      diagnostic.fileName.startsWith(sdkDeclarationsDir + path.sep),
    );

    expect(groupBySummary(sdkDeclarationDiagnostics)).toEqual([]);
  });
});
