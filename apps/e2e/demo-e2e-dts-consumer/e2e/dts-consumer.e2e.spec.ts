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

const fixtureFiles = ['tool-must-fail.ts', 'prompts-must-compile.ts'].map((fileName) =>
  path.join(fixtureDir, fileName),
);

function compileFixture(): { diagnostics: FixtureDiagnostic[]; sourceFiles: string[] } {
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
  const program = ts.createProgram({ rootNames: parsedConfig.fileNames, options: parsedConfig.options });
  return {
    diagnostics: [...parsedConfig.errors, ...ts.getPreEmitDiagnostics(program)].map(toFixtureDiagnostic),
    sourceFiles: program.getSourceFiles().map((sourceFile) => path.resolve(sourceFile.fileName)),
  };
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

  it('accepts the documented @Prompt forms', () => {
    expect(describeEach(inFixtureFile('prompts-must-compile.ts'))).toEqual([]);
  });

  it('ships declaration files that type-check with skipLibCheck disabled', () => {
    const sdkDeclarationDiagnostics = diagnostics.filter((diagnostic) =>
      diagnostic.fileName.startsWith(sdkDeclarationsDir + path.sep),
    );

    expect(groupBySummary(sdkDeclarationDiagnostics)).toEqual([]);
  });
});
