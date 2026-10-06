import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Plugin, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';
import { ElicitationRequestHook, ElicitationResultHook } from '../../elicitation/hooks/elicitation.hooks';

const ranStages: string[] = [];

@Plugin({ name: 'elicitation-audit' })
class ElicitationAuditPlugin {
  @ElicitationRequestHook.Did('buildRequestParams')
  async afterRequest() {
    ranStages.push('elicitation:request');
  }

  @ElicitationResultHook.Did('buildResult')
  async afterResult() {
    ranStages.push('elicitation:result');
  }
}

@Tool({ name: 'confirm', inputSchema: { ttl: z.number().optional() } })
class ConfirmTool extends ToolContext {
  async execute(input: { ttl?: number }) {
    const answer = await this.elicit('Proceed?', z.object({ confirmed: z.boolean() }), { ttl: input.ttl });
    return { action: answer.status, confirmed: answer.content?.confirmed ?? false };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ConfirmTool], plugins: [ElicitationAuditPlugin] })
class DeskApp {}

function config(): FrontMcpConfigInput {
  return {
    info: { name: 'in-memory-elicitation', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    elicitation: { enabled: true },
  };
}

describe('elicitation through the in-memory transport', () => {
  beforeEach(() => {
    ranStages.length = 0;
  });

  it('runs the elicitation:request and elicitation:result flows, so their hooks fire', async () => {
    const client = await connect(config(), {
      onElicitation: async () => ({ action: 'accept', content: { confirmed: true } }),
    });

    const result = (await client.callTool('confirm', {})) as { structuredContent?: unknown };
    await client.close();

    expect(result.structuredContent).toEqual({ action: 'accept', confirmed: true });
    expect(ranStages).toEqual(['elicitation:request', 'elicitation:result']);
  });

  it('fails an unanswered question with ElicitationTimeoutError', async () => {
    const client = await connect(config(), { onElicitation: () => new Promise(() => undefined) });

    const result = (await client.callTool('confirm', { ttl: 50 })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    await client.close();

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Elicitation request timed out after');
  });
});
