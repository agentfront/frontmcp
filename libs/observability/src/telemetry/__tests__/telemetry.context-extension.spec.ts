import 'reflect-metadata';

import { join } from 'node:path';

import * as ts from 'typescript';

import {
  App,
  connect,
  ExecutionContextBase,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  type DirectClient,
  type ReadResourceResult,
} from '@frontmcp/sdk';

import type {} from '../../index';

import ObservabilityPlugin from '../../plugin/observability.plugin';
import { TelemetryAccessor } from '../telemetry.accessor';

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

function traceIdOf(telemetry: TelemetryAccessor): string {
  return telemetry instanceof TelemetryAccessor ? telemetry.traceId : 'not a TelemetryAccessor';
}

function typeErrorsOf(fileName: string): string[] {
  const libConfigPath = join(__dirname, '..', '..', '..', 'tsconfig.lib.json');
  const parsedConfig = ts.getParsedCommandLineOfConfigFile(
    libConfigPath,
    { noEmit: true, types: ['node', 'jest'] },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!parsedConfig) {
    throw new Error(`Could not parse ${libConfigPath}`);
  }
  const program = ts.createProgram([fileName], parsedConfig.options);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

@Prompt({ name: 'telemetry-trace' })
class TelemetryTracePrompt extends PromptContext {
  async execute() {
    return traceIdOf(this.telemetry);
  }
}

@Resource({ name: 'telemetry-trace', uri: 'telemetry://trace' })
class TelemetryTraceResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: traceIdOf(this.telemetry) }] };
  }
}

@App({
  id: 'telemetry-contexts',
  name: 'Telemetry Contexts',
  plugins: [ObservabilityPlugin.init()],
  prompts: [TelemetryTracePrompt],
  resources: [TelemetryTraceResource],
})
class TelemetryContextsApp {}

describe('this.telemetry context extension', () => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect({
      info: { name: 'telemetry-context-extension', version: '1.0.0' },
      apps: [TelemetryContextsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('types this.telemetry as TelemetryAccessor in PromptContext and ExecutionContextBase subclasses', () => {
    expect(typeErrorsOf(__filename)).toEqual([]);
  }, 60_000);

  it('installs the telemetry getter on ExecutionContextBase, which PromptContext inherits', () => {
    expect(Object.getOwnPropertyDescriptor(ExecutionContextBase.prototype, 'telemetry')?.get).toBeInstanceOf(Function);
    expect(PromptContext.prototype).toBeInstanceOf(ExecutionContextBase);
  });

  it('resolves this.telemetry to a TelemetryAccessor inside a prompt', async () => {
    const result = await client.getPrompt('telemetry-trace');

    expect(result.messages[0].content).toEqual({ type: 'text', text: expect.stringMatching(TRACE_ID_PATTERN) });
  });

  it('resolves this.telemetry to a TelemetryAccessor inside a resource', async () => {
    const result = await client.readResource('telemetry://trace');

    expect(result.contents[0]).toEqual(
      expect.objectContaining({ uri: 'telemetry://trace', text: expect.stringMatching(TRACE_ID_PATTERN) }),
    );
  });
});
