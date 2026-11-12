/** @jest-environment node */
/**
 * `@frontmcp/react` re-exports the `@Event` decorator, so it re-exports what an `@Event` class is written with:
 * the `EventContext` base class and the types its methods take and return.
 */
import { resolve } from 'node:path';

import * as ts from 'typescript';

function strictCompileErrors(fileName: string): string[] {
  const configFile = resolve(__dirname, '../../tsconfig.spec.json');
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

it('compiles an @Event class that extends EventContext, imported from @frontmcp/react alone', () => {
  expect(strictCompileErrors(resolve(__dirname, 'fixtures/event-context.fixture.ts'))).toEqual([]);
}, 120_000);
