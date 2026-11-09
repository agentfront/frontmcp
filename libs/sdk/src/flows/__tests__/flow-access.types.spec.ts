/**
 * `@Flow({ access })` says who a flow runs for, so every flow sets it, as 1.11.2 required: the decorators skill's `@Flow`
 * example compiles under strict, and a flow without `access` does not.
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

it("compiles the decorators skill's @Flow example under strict", () => {
  expect(strictCompileErrors(resolve(__dirname, 'fixtures/decorators-guide-flow.fixture.ts'))).toEqual([]);
}, 60_000);

it('refuses a @Flow without access: its fixture expects the error', () => {
  expect(strictCompileErrors(resolve(__dirname, 'fixtures/flow-without-access.fixture.ts'))).toEqual([]);
}, 60_000);
