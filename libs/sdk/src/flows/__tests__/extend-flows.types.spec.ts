/**
 * A built-in flow's `ExtendFlows` entry is declared in its own module, so consumers see it only when the published
 * declarations reach that module from `index.d.ts`. Without it, `FlowHooksOf('<name>')`, `FlowCtxOf` and `@Flow`
 * reject the flow's name. The spec emits the SDK's declarations in memory and walks them from `index.d.ts`.
 */
import { dirname, join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

const sdkSourceDir = resolve(__dirname, '../..');
const outDir = '/virtual-declarations';

function emitDeclarations(): Map<string, string> {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(sdkSourceDir, '../tsconfig.json'), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!parsed) throw new Error('libs/sdk/tsconfig.json could not be read');
  const program = ts.createProgram([join(sdkSourceDir, 'index.ts')], {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    composite: false,
    incremental: false,
    skipLibCheck: true,
    types: ['node'],
    rootDir: sdkSourceDir,
    outDir,
  });
  const declarations = new Map<string, string>();
  program.emit(undefined, (fileName, text) => declarations.set(fileName, text), undefined, true);
  return declarations;
}

function declarationsReachableFromIndex(declarations: Map<string, string>): Set<string> {
  const specifierPattern = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.[^'"]*)['"]/g;
  const reached = new Set<string>();
  const pending = [join(outDir, 'index.d.ts')];
  while (pending.length > 0) {
    const fileName = pending.pop() as string;
    const text = declarations.get(fileName);
    if (text === undefined || reached.has(fileName)) continue;
    reached.add(fileName);
    for (const [, specifier] of text.matchAll(specifierPattern)) {
      const target = resolve(dirname(fileName), specifier.replace(/\.js$/, ''));
      pending.push(`${target}.d.ts`, join(target, 'index.d.ts'));
    }
  }
  return reached;
}

function modulesDeclaringFlows(): string[] {
  return ts.sys
    .readDirectory(sdkSourceDir, ['.ts'], ['**/__tests__/**', '**/*.spec.ts'])
    .filter((fileName) => !fileName.endsWith('common/metadata/flow.metadata.ts'))
    .filter((fileName) => ts.sys.readFile(fileName)?.includes('interface ExtendFlows {'));
}

describe('ExtendFlows in the published types', () => {
  it('reaches every built-in flow module from index.d.ts', () => {
    const reached = declarationsReachableFromIndex(emitDeclarations());

    const unreached = modulesDeclaringFlows()
      .map((fileName) => relative(sdkSourceDir, fileName))
      .filter((fileName) => !reached.has(join(outDir, fileName.replace(/\.ts$/, '.d.ts'))));

    expect(unreached).toEqual([]);
  }, 120_000);
});
