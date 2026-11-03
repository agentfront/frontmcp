/**
 * CodeCall and a lazy app (`apps: [{ name, lazy }]`): until the app is imported its tools are placeholders listed from
 * frontmcp.manifest.json, which does not record `codecall`, so CodeCall's policy would judge an opted-out tool by its
 * placeholder and then run the loaded tool. A lazy app's entries cannot declare `codecall`.
 */
import 'reflect-metadata';

import { type CallToolResult } from '@frontmcp/protocol';
import { App, buildManifest, connect, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

const ran: string[] = [];

@Tool({ name: 'purge', description: 'Purge the vault', inputSchema: {}, codecall: { enabledInCodeCall: false } })
class OptedOutPurgeTool extends ToolContext {
  async execute() {
    ran.push('purge');
    return { purged: true };
  }
}

@App({ id: 'vault', name: 'Vault', tools: [OptedOutPurgeTool] })
class VaultApp {}

@Tool({ name: 'purge', description: 'Purge the vault', inputSchema: {} })
class PurgeTool extends ToolContext {
  async execute() {
    return { purged: true };
  }
}

@App({ id: 'vault', name: 'Vault', tools: [PurgeTool] })
class VaultAppBeforeTheOptOut {}

function lazyVaultServer(lazy: () => Promise<unknown>, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'codecall-lazy-app', version: '1.0.0' },
    apps: [{ id: 'vault', name: 'Vault', lazy }],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
    logging: { level: LogLevel.Off },
    ...extra,
  } as FrontMcpConfigInput;
}

describe('CodeCall and a lazy app', () => {
  it('refuses to build the manifest of a lazy app whose tool declares codecall', async () => {
    await expect(buildManifest(lazyVaultServer(async () => ({ VaultApp })))).rejects.toThrow(
      /App "vault" cannot be lazy: tool "purge" declares 'codecall'/,
    );
  });

  it('never runs an opted-out tool a stale manifest lists, through codecall:execute', async () => {
    const manifest = await buildManifest(lazyVaultServer(async () => ({ VaultAppBeforeTheOptOut })));
    const client = await connect(lazyVaultServer(async () => ({ VaultApp }), { manifest }));

    const result = (await client.callTool('codecall:execute', {
      script: "return await callTool('purge', {});",
    })) as CallToolResult;
    await client.close();

    expect(result.structuredContent).toEqual(expect.objectContaining({ status: 'tool_error' }));
    expect(ran).toEqual([]);
  });
});
