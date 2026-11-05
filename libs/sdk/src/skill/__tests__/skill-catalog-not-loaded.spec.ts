/**
 * A plugin whose runtime skills haven't loaded (`SkillCatalogSource.notLoadedReason`) makes the SDK's skill surfaces
 * answer the retryable `SKILL_BUNDLE_NOT_LOADED` error, not an empty catalog a client would cache. Once they load,
 * the surfaces list them, with each bundle skill's `bundleVersion`. Read through a direct client, on a real scope.
 */
import 'reflect-metadata';

import { McpError } from '@frontmcp/protocol';

import { App, DynamicPlugin, LogLevel, Plugin, ScopeEntry, Tool, ToolContext } from '../../common';
import { connect, type DirectClient } from '../../direct';
import { MCP_ERROR_CODES } from '../../errors';
import { SkillCatalogSourceToken, type SkillCatalogSource } from '../skill-catalog-source';

const bundleState: { notLoadedReason?: string } = {};

const bundleSource: SkillCatalogSource = {
  ready: async () => undefined,
  notLoadedReason: () => bundleState.notLoadedReason,
};

/** Registers the bundle's skill, as a bundle loader does once its pull succeeds. */
@Tool({ name: 'load_bundle', inputSchema: {} })
class LoadBundleTool extends ToolContext {
  async execute() {
    await this.get(ScopeEntry).skills.registerSkillContent({
      id: 'invoices',
      name: 'invoices',
      description: 'Look up invoices.',
      instructions: '# Invoices',
      tools: [],
      bundleVersion: '2.0.0',
    });
    bundleState.notLoadedReason = undefined;
    return { loaded: true };
  }
}

@Plugin({ name: 'bundle-skills', dynamicSkills: true, tools: [LoadBundleTool] })
class BundleSkillsPlugin extends DynamicPlugin<Record<string, never>> {}

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

async function rejectionOf(answer: Promise<unknown>): Promise<McpError> {
  const error = await answer.then(
    () => undefined,
    (rejected: unknown) => rejected,
  );
  if (!(error instanceof McpError)) throw new Error(`expected an McpError, got ${String(error)}`);
  return error;
}

function expectNotLoaded(error: McpError): void {
  expect(error.code).toBe(MCP_ERROR_CODES.INTERNAL_ERROR);
  expect(error.message).toContain('No skill bundle is loaded: pull responded 503');
  expect(error.data).toMatchObject({ code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true });
}

describe("the SDK's skill surfaces while a plugin's skills haven't loaded", () => {
  let client: DirectClient;
  const notifications: string[] = [];

  beforeAll(async () => {
    bundleState.notLoadedReason = 'pull responded 503';
    client = await connect({
      info: { name: 'bundle-server', version: '1.0.0' },
      apps: [EmptyApp],
      plugins: [BundleSkillsPlugin],
      providers: [{ name: 'test:skill-source', provide: SkillCatalogSourceToken, useValue: bundleSource }],
      logging: { level: LogLevel.Off },
    });
    client.onNotification(({ method }) => notifications.push(method));
  });

  afterAll(async () => {
    await client?.close();
  });

  it('answers skills/list, skills/search and skills/load with the retryable error', async () => {
    expectNotLoaded(await rejectionOf(client.listSkills()));
    expectNotLoaded(await rejectionOf(client.searchSkills('invoices')));
    expectNotLoaded(await rejectionOf(client.loadSkills(['invoices'])));
  });

  it("answers skill://index.json and a skill's SKILL.md with it, not an empty index or not found", async () => {
    expectNotLoaded(await rejectionOf(client.readResource('skill://index.json')));
    expectNotLoaded(await rejectionOf(client.readResource('skill://invoices/SKILL.md')));
  });

  it('lists and finds the skills once they load, with their bundleVersion, after a list_changed', async () => {
    await client.callTool('load_bundle', {});

    const listed = await client.listSkills();
    const found = await client.searchSkills('invoices');
    const index = await client.readResource('skill://index.json');

    expect(listed.skills).toEqual([
      expect.objectContaining({ id: 'invoices', name: 'invoices', bundleVersion: '2.0.0' }),
    ]);
    expect(found.skills).toEqual([expect.objectContaining({ id: 'invoices', bundleVersion: '2.0.0' })]);
    expect(JSON.stringify(index.contents)).toContain('skill://invoices/SKILL.md');
    expect(notifications).toContain('notifications/skills/list_changed');
  });
});
