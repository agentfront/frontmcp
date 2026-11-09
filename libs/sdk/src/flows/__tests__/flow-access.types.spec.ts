/**
 * `@Flow({ access })` is never read, so it is optional and deprecated: the decorators skill's `@Flow` example, which
 * leaves it out, compiles under strict.
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

it("compiles the decorators skill's @Flow example, which sets no access, under strict", () => {
  expect(strictCompileErrors(resolve(__dirname, 'fixtures/flow-without-access.fixture.ts'))).toEqual([]);
}, 60_000);
