import { z } from '@frontmcp/lazy-zod';
import {
  App,
  Prompt,
  PromptContext,
  PublicMcpError,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
} from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

/** `v1` or `v2` of the fixture: v2 changes the quote price, fails `pay` and fixes `refund`. */
const isV2 = () => process.env['FIXTURE_VERSION'] === 'v2';

@Tool({ name: 'ping', description: 'Answers the same in both versions', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({
  name: 'quote',
  description: 'A price that v2 raises, with a time and an id that change on every call',
  inputSchema: { city: z.string() },
})
class QuoteTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city, price: isV2() ? 15 : 12, quotedAt: new Date().toISOString(), quoteId: randomUUID() };
  }
}

@Tool({ name: 'pay', description: 'Pays in v1 and fails in v2', inputSchema: {} })
class PayTool extends ToolContext {
  async execute() {
    if (isV2()) throw new PublicMcpError('ledger offline', 'LEDGER_OFFLINE');
    return { paid: true };
  }
}

@Tool({ name: 'refund', description: 'Fails in v1 and refunds in v2', inputSchema: {} })
class RefundTool extends ToolContext {
  async execute() {
    if (!isV2()) throw new PublicMcpError('refunds closed', 'REFUNDS_CLOSED');
    return { refunded: true };
  }
}

@Tool({
  name: 'login',
  description: 'Answers with a credential the recording must not keep',
  inputSchema: { user: z.string(), password: z.string() },
})
class LoginTool extends ToolContext {
  async execute(input: { user: string; password: string }) {
    return { user: input.user, accessToken: 'tok-e2e-secret' };
  }
}

@Resource({ name: 'motd', uri: 'notes://motd', mimeType: 'text/plain' })
class MotdResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'Welcome' }] };
  }
}

@Prompt({ name: 'greet', arguments: [{ name: 'who', required: true }] })
class GreetPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Hello ${args['who']}` } }] };
  }
}

@App({
  name: 'Replay',
  description: 'A fixture in two versions, recorded on v1 and replayed on v2',
  tools: [PingTool, QuoteTool, PayTool, RefundTool, LoginTool],
  resources: [MotdResource],
  prompts: [GreetPrompt],
})
export class ReplayApp {}
