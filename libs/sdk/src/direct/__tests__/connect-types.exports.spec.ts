/**
 * The types a `connect()` client's options, handlers and results use are exported from `@frontmcp/sdk` (#1176), so
 * `LoadSkillsOptions<'markdown'>` and an `ElicitationHandler` can be written down. The fixture imports them from the
 * package's entry point and is compiled under strict.
 */
import { resolve } from 'node:path';

import * as ts from 'typescript';

function strictCompileErrors(fileName: string): string[] {
  const configFile = resolve(__dirname, '../../../tsconfig.spec.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!parsed) throw new Error(`${configFile} could not be read`);
  const program = ts.createProgram([fileName], {
    ...parsed.options,
    strict: true,
    noEmit: true,
    composite: false,
    declaration: false,
    rootDir: undefined,
  });
  const sourceFile = program.getSourceFile(fileName);
  return [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)].map(
    (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
}

it("compiles a connect() client's skills, elicitation, completion and logging types imported from the SDK", () => {
  expect(strictCompileErrors(resolve(__dirname, 'fixtures/connect-types.fixture.ts'))).toEqual([]);
}, 60_000);
