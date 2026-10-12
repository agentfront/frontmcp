/**
 * `getConfig` and `tryGetConfig` take a tool's `this` under strict TypeScript. Their parameter used to require
 * `get: (token: unknown) => unknown`, which a context's `get<T>(token: Token<T>): T` doesn't satisfy (TS2345).
 */
import { resolve } from 'node:path';

import * as ts from 'typescript';

function strictCompileErrors(fileName: string): string[] {
  const configFile = resolve(__dirname, '../../../../tsconfig.spec.json');
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

it('compiles getConfig(this) and tryGetConfig(this) in a ToolContext under strict', () => {
  expect(strictCompileErrors(resolve(__dirname, 'fixtures/config-helpers.fixture.ts'))).toEqual([]);
}, 60_000);
