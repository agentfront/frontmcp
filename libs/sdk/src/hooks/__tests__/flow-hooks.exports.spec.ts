/**
 * The SDK exports hook decorators for the prompt and completion flows, as it does for tools and
 * resources. Exporting them puts those flows' augmentations in the published type graph, so
 * `FlowHooksOf('prompts:get-prompt' | 'prompts:list-prompts' | 'completion:complete')` typechecks
 * for consumers (#678). Every exported hook decorator types the decorated method's parameter against
 * its flow's ctx, so a hook that reads a property the flow does not have fails to compile.
 */
import 'reflect-metadata';

import { resolve } from 'node:path';

import * as ts from 'typescript';

import { type GetPromptResult } from '@frontmcp/protocol';

import { type HookMetadata } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import * as sdk from '../../index';
import {
  App,
  CompletionHook,
  FlowHooksOf,
  ListPromptsHook,
  LogLevel,
  Plugin,
  Prompt,
  PromptContext,
  PromptHook,
  type FlowCtxOf,
} from '../../index';
import { collectHook } from '../hooks.utils';

const runs: string[] = [];

@Plugin({ name: 'prompt-audit' })
class PromptAuditPlugin {
  @PromptHook.Will('execute')
  beforePrompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    runs.push(`get:${ctx.state.prompt?.name}`);
  }

  @ListPromptsHook.Did('findPrompts')
  afterList() {
    runs.push('list');
  }

  @CompletionHook.Will('complete')
  beforeComplete() {
    runs.push('complete');
  }
}

@Prompt({ name: 'greeting', arguments: [] })
class GreetingPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] };
  }
}

@App({ id: 'prompts', name: 'Prompts', plugins: [PromptAuditPlugin], prompts: [GreetingPrompt] })
class PromptsApp {}

const typedCtxFixture = resolve(__dirname, 'fixtures/typed-hook-ctx.fixture.ts');

function strictCompileErrors(fileName: string, sourceText?: string): string[] {
  const configFile = resolve(__dirname, '../../../tsconfig.spec.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
  });
  if (!parsed) throw new Error(`${configFile} could not be read`);
  const options = {
    ...parsed.options,
    strict: true,
    noEmit: true,
    composite: false,
    declaration: false,
    rootDir: undefined,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    sourceText !== undefined && resolve(name) === fileName
      ? ts.createSourceFile(name, sourceText, languageVersion)
      : getSourceFile(name, languageVersion, ...rest);
  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName);
  return [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)].map(
    (diagnostic) => {
      const line = sourceFile?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line ?? -1;
      return `${line + 1}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    },
  );
}

describe('hook decorator types', () => {
  it('reject a parameter the flow ctx does not satisfy and accept the ctx or a subset of it, for every export', () => {
    expect(strictCompileErrors(typedCtxFixture)).toEqual([]);
  }, 120_000);

  it('fail with TS1241, on each decorator the fixture expects to fail, once its @ts-expect-error is removed', () => {
    const fixture = ts.sys.readFile(typedCtxFixture) ?? '';
    const expectedFailures = fixture
      .split('\n')
      .flatMap((line, index) => (line.includes('// @ts-expect-error') ? [`${index + 2}: TS1241`] : []));
    const errors = strictCompileErrors(typedCtxFixture, fixture.replaceAll('// @ts-expect-error', '// expected:'));

    expect(expectedFailures.length).toBeGreaterThan(20);
    expect(errors.map((error) => error.split(' ', 2).join(' '))).toEqual(expectedFailures);
  }, 120_000);

  it('are checked in the fixture for every exported hook helper', () => {
    const decorators = Object.keys(FlowHooksOf('tools:call-tool'));
    const isHookHelper = (value: unknown) =>
      typeof value === 'object' &&
      value !== null &&
      decorators.every((decorator) => typeof Reflect.get(value, decorator) === 'function');
    const exportedHelpers = Object.entries(sdk)
      .filter(([, value]) => isHookHelper(value))
      .map(([name]) => name)
      .sort();
    const fixture = ts.sys.readFile(typedCtxFixture) ?? '';
    const checkedHelpers = [...fixture.matchAll(/has no notAField\n {2}@(\w+)\.Will\(/g)].map(([, name]) => name);

    expect(exportedHelpers.length).toBeGreaterThan(10);
    expect([...new Set(checkedHelpers)].sort()).toEqual(exportedHelpers);
  });
});

describe('prompt and completion hook exports', () => {
  it('register hooks for their flows', () => {
    const flows = (collectHook(PromptAuditPlugin) as HookMetadata[]).map((hook) => `${hook.flow}:${hook.stage}`);
    expect(flows).toEqual([
      'prompts:get-prompt:execute',
      'prompts:list-prompts:findPrompts',
      'completion:complete:complete',
    ]);
  });

  it('give the same decorators as FlowHooksOf', () => {
    expect(Object.keys(PromptHook)).toEqual(Object.keys(FlowHooksOf('prompts:get-prompt')));
  });

  describe('at runtime', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await FrontMcpInstance.createDirect({
        info: { name: 'prompt-hooks', version: '1.0.0' },
        apps: [PromptsApp],
        logging: { level: LogLevel.Off },
      });
    });

    afterAll(async () => {
      await server.dispose();
    });

    beforeEach(() => {
      runs.length = 0;
    });

    it('run on prompts/get and prompts/list', async () => {
      await server.getPrompt('greeting', {});
      await server.listPrompts();

      expect(runs).toEqual(['get:greeting', 'list']);
    });
  });
});
