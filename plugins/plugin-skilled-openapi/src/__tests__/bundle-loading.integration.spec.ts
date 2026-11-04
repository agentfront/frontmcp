/**
 * What a client sees of the bundle's load: a real server, with the bundle loaded, failed, or fixed after a failure.
 */
import 'reflect-metadata';

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';

import { SkilledOpenApiPlugin, type SkilledOpenApiPluginOptionsInput } from '../index';

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '4.2.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: 'https://203.0.113.10/v1' }],
  authBindings: { none: { kind: 'none' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Issue and refund billing invoices.',
      instructions: '# Invoices',
      operationIds: [],
    },
    {
      id: 'reports',
      name: 'Reports',
      description: 'Build billing reports.',
      instructions: '# Reports',
      operationIds: [],
    },
  ],
  operations: {},
};

const bundleYaml = `schemaVersion: 1
bundleId: acme:billing
version: 4.2.1
generatedAt: 2026-09-02T08:30:00.000Z
sourceDigest: "${'0'.repeat(64)}"
services:
  - id: billing
    baseUrl: https://203.0.113.10/v1
authBindings:
  none:
    kind: none
skills:
  - id: invoices
    name: Invoices
    description: Issue and refund billing invoices.
    instructions: "# Invoices"
    operationIds: []
operations: {}
`;

const servers: DirectMcpServer[] = [];

async function startServer(options: SkilledOpenApiPluginOptionsInput): Promise<DirectMcpServer> {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    plugins: [SkilledOpenApiPlugin.init(options)],
    logging: { level: LogLevel.Off },
  } as never);
  servers.push(server);
  return server;
}

/** Calls search_skill until the bundle has loaded and it stops answering an error, or the deadline passes. */
async function searchOnceLoaded(server: DirectMcpServer, query: string): Promise<unknown> {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      return (await server.callTool('search_skill', { query })).structuredContent;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

afterAll(async () => {
  await Promise.all(servers.map((server) => server.dispose()));
});

describe('a server whose bundle failed to load', () => {
  it('answers search_skill, load_skill, execute_action and run_workflow with why no skill bundle is loaded', async () => {
    const server = await startServer({ source: { type: 'inline', content: bundle }, requireSignature: true });
    const reason =
      'No skill bundle is loaded: bundle acme:billing@4.2.0 was not applied: bundle missing integrity envelope';

    await expect(server.callTool('search_skill', { query: 'invoices' })).rejects.toThrow(reason);
    await expect(server.callTool('load_skill', { skillId: 'invoices' })).rejects.toThrow(reason);
    await expect(server.callTool('execute_action', { actionId: 'getInvoice' })).rejects.toThrow(reason);
    await expect(server.callTool('run_workflow', { script: 'return 1' })).rejects.toThrow(reason);
  });

  it('serves the skills once a fixed file reloads, and keeps a YAML timestamp a string', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-bundle-loading-'));
    const file = path.join(directory, 'bundle.yaml');
    await fs.writeFile(file, 'schemaVersion: [unclosed', 'utf8');
    try {
      const server = await startServer({ source: { type: 'static', path: file, watch: true }, dev: true });
      await expect(server.callTool('search_skill', { query: 'invoices' })).rejects.toThrow(
        /^No skill bundle is loaded: Overlay YAML parse failed: /,
      );

      await fs.writeFile(file, bundleYaml, 'utf8');

      expect(await searchOnceLoaded(server, 'invoices')).toMatchObject({
        skills: [{ skillId: 'invoices', bundleVersion: '4.2.1' }],
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('search_skill on a loaded bundle', () => {
  it("reports each skill's bundleVersion", async () => {
    const server = await startServer({ source: { type: 'inline', content: bundle }, dev: true });

    const searched = await server.callTool('search_skill', { query: 'billing' });

    expect(searched.structuredContent).toEqual({
      skills: [
        expect.objectContaining({ skillId: 'invoices', bundleVersion: '4.2.0' }),
        expect.objectContaining({ skillId: 'reports', bundleVersion: '4.2.0' }),
      ],
    });
  });
});
