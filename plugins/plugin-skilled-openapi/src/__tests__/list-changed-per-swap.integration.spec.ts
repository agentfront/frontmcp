// A connected client of a real server is told once per list that a bundle swap changed (pulled, pushed, or one with no
// skills), not once per skill, operation tool and skill resource the swap registers or removes. The operation tools are
// internal, never in tools/list, so a swap sends no tools/list_changed. A refused bundle, the bundle being served pulled
// again, and a bundle rolled back to the one served change nothing and send nothing.
import 'reflect-metadata';

import type { BundleCacheStore, ResolvedBundle } from '@frontmcp/adapters/skills';
import { Client } from '@frontmcp/protocol/client';
import {
  createInMemoryServer,
  createWebFetchHandler,
  FrontMcpInstance,
  LogLevel,
  type SkillRegistryInterface,
} from '@frontmcp/sdk';

import { type BundleSyncOutcome } from '../index';
import SkilledOpenApiPlugin, { SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN } from '../skilled-openapi.plugin';
import { AUDIENCE, bundle, ENDPOINT, ISSUER, JWKS_URL, signed, tokenIssuer, trustedKey } from './saas-bundles.fixture';

const PUSH_URL = 'http://localhost/__skilled_openapi/push';

/** The bundle at `version` serving `skills`, each with the GET operations it lists. */
function billingBundle(version: string, skills: Record<string, string[]>): ResolvedBundle {
  const unsigned = bundle(version, Object.keys(skills));
  const operationIds = [...new Set(Object.values(skills).flat())];
  return {
    ...unsigned,
    skills: unsigned.skills.map((skill) => ({ ...skill, operationIds: skills[skill.id] })),
    operations: Object.fromEntries(
      operationIds.map((operationId) => [
        operationId,
        {
          operationId,
          serviceId: 'billing',
          httpMethod: 'GET',
          pathTemplate: `/v1/${operationId}`,
          inputSchema: {},
          outputSchema: {},
          mapper: [],
          authBindingRef: 'none',
        },
      ]),
    ),
  };
}

/**
 * A bundle that replaces `invoices` and adds `legacy`, then fails on `ledger`, whose id is the skill:// path of
 * `legacy`: it is rolled back after it changed the skills.
 */
function collidingBundle(version: string): ResolvedBundle {
  const colliding = billingBundle(version, { invoices: ['listInvoices'], legacy: ['listPayouts'], ledger: [] });
  colliding.skills[1].name = 'archive';
  colliding.skills[2].id = 'archive';
  return colliding;
}

const ONE_RESOURCES_AND_SKILLS_LIST_CHANGED = {
  'notifications/resources/list_changed': 1,
  'notifications/skills/list_changed': 1,
};

interface SkilledServer {
  refresh(): Promise<BundleSyncOutcome>;
  push(body: unknown): Promise<Response>;
  /** The `list_changed` notifications the connected client got since `seen`, counted by method. */
  listChangedSince(seen: number): Record<string, number>;
  notificationCount(): number;
  /** The ids of the skills the server lists. */
  skillIds(): string[];
  skills: SkillRegistryInterface;
  close(): Promise<void>;
}

describe('list_changed notifications of a bundle swap', () => {
  let issuer: Awaited<ReturnType<typeof tokenIssuer>>;
  let published: ResolvedBundle | 'outage';
  let fetchMock: jest.SpyInstance;
  const emptyCache: BundleCacheStore = { read: async () => undefined, write: async () => undefined };

  /** A server that pulls from the mocked bundle server when refreshed, takes pushes, and has a client connected. */
  async function startServer(): Promise<SkilledServer> {
    let refresher: { refresh(): Promise<BundleSyncOutcome> } | undefined;
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'billing', version: '1.0.0' },
      apps: [],
      serve: false,
      instructionsBudget: false,
      plugins: [
        SkilledOpenApiPlugin.init({
          source: {
            type: 'saas',
            endpoint: ENDPOINT,
            authToken: await issuer.sign({}),
            expectedAudience: AUDIENCE,
            jwksUrl: JWKS_URL,
            expectedIssuer: ISSUER,
            enableWebhook: true,
          },
          trustedKeys: [trustedKey],
        }),
      ],
      providers: [
        {
          name: 'test:runtime-deps',
          provide: SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN,
          useValue: {
            cache: emptyCache,
            disablePolling: true,
            attach: (attached: { refresh(): Promise<BundleSyncOutcome> }) => {
              refresher = attached;
            },
          },
        },
      ],
      logging: { level: LogLevel.Off },
    } as never);
    const scope = instance.getPrimaryScope();
    if (!scope) throw new Error('the server config produced no scope');
    await instance.emitProvidersReady();
    const handler = createWebFetchHandler(scope as Parameters<typeof createWebFetchHandler>[0]);
    const inMemory = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    const methods: string[] = [];
    const client = new Client({ name: 'list-changed-counter', version: '1.0.0' });
    client.fallbackNotificationHandler = async ({ method }) => {
      methods.push(method);
    };
    await client.connect(inMemory.clientTransport);
    await settle();

    return {
      refresh: async () => {
        if (!refresher) throw new Error('the plugin attached no refresh');
        const outcome = await refresher.refresh();
        await settle();
        return outcome;
      },
      push: async (body) => {
        const response = await handler(
          new Request(PUSH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${await issuer.pushToken()}` },
            body: JSON.stringify(body),
          }),
        );
        await settle();
        return response;
      },
      listChangedSince: (seen) => {
        const counts: Record<string, number> = {};
        for (const method of methods.slice(seen).filter((sent) => sent.endsWith('/list_changed'))) {
          counts[method] = (counts[method] ?? 0) + 1;
        }
        return counts;
      },
      notificationCount: () => methods.length,
      skillIds: () => scope.skills.getSkills().map((skill) => skill.metadata.id ?? skill.name),
      skills: scope.skills,
      close: async () => {
        await client.close();
        await inMemory.close();
      },
    };
  }

  async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeAll(async () => {
    issuer = await tokenIssuer('cloud-2026');
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === JWKS_URL) return Response.json(issuer.jwks);
      if (url !== ENDPOINT) return new Response('not found', { status: 404 });
      if (published === 'outage') throw new TypeError('fetch failed');
      return Response.json(published);
    });
  });

  afterAll(() => {
    fetchMock?.mockRestore();
  });

  describe('on a server serving a bundle', () => {
    let server: SkilledServer;

    beforeAll(async () => {
      published = signed(
        billingBundle('1.0.0', { invoices: ['listInvoices', 'getInvoice'], reports: ['getReport', 'listReports'] }),
      );
      server = await startServer();
    });

    afterAll(async () => {
      await server?.close();
    });

    it('sends one resources and skills list_changed for a pulled bundle that changes its skills and operations', async () => {
      published = signed(
        billingBundle('2.0.0', { invoices: ['listInvoices'], refunds: ['refundInvoice', 'getRefund'] }),
      );
      const seen = server.notificationCount();

      const outcome = await server.refresh();

      expect(outcome.status).toBe('applied');
      expect(server.listChangedSince(seen)).toEqual(ONE_RESOURCES_AND_SKILLS_LIST_CHANGED);
    });

    it('sends nothing when a pull brings the bundle being served again', async () => {
      const seen = server.notificationCount();

      const outcome = await server.refresh();

      expect(outcome.status).toBe('unchanged');
      expect(server.listChangedSince(seen)).toEqual({});
    });

    it('sends one resources and skills list_changed for a pushed bundle', async () => {
      const seen = server.notificationCount();

      const response = await server.push(
        signed(billingBundle('3.0.0', { invoices: ['listInvoices', 'getInvoice'], disputes: ['listDisputes'] })),
      );

      expect(response.status).toBe(200);
      expect(server.listChangedSince(seen)).toEqual(ONE_RESOURCES_AND_SKILLS_LIST_CHANGED);
    });

    it('sends nothing for a bundle it refuses', async () => {
      const seen = server.notificationCount();

      const response = await server.push(billingBundle('4.0.0', { payouts: ['listPayouts'] }));

      expect(response.status).toBe(422);
      expect(server.listChangedSince(seen)).toEqual({});
    });

    it('sends nothing for a bundle that fails before it changes a registry, and is rolled back', async () => {
      const missingDependency = billingBundle('4.1.0', { payouts: ['listPayouts'] });
      missingDependency.skills[0].requires = ['treasury'];
      const seen = server.notificationCount();

      const response = await server.push(signed(missingDependency));

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error_description: expect.stringContaining('skill "payouts" requires "treasury"'),
      });
      expect(server.listChangedSince(seen)).toEqual({});
    });

    it('sends nothing for a bundle that fails after it registered skills and replaced one, and is rolled back', async () => {
      const seen = server.notificationCount();

      const response = await server.push(signed(collidingBundle('4.2.0')));

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error_description: expect.stringContaining('id "archive" of skill "ledger" is the skill:// path of skill'),
      });
      expect(server.skillIds().sort()).toEqual(['disputes', 'invoices']);
      expect(server.listChangedSince(seen)).toEqual({});
    });

    it('sends one resources and skills list_changed for a rollback that could not restore a skill it replaced', async () => {
      const registerSkillContent = server.skills.registerSkillContent.bind(server.skills);
      const restoreFails = jest
        .spyOn(server.skills, 'registerSkillContent')
        .mockImplementation(async (content, options) => {
          if (options?.source?.endsWith(':rollback')) throw new Error('the registry refused the restore');
          return registerSkillContent(content, options);
        });
      const seen = server.notificationCount();

      try {
        const response = await server.push(signed(collidingBundle('4.3.0')));

        expect(response.status).toBe(422);
        expect(server.skillIds()).toEqual(['disputes']);
        expect(server.listChangedSince(seen)).toEqual(ONE_RESOURCES_AND_SKILLS_LIST_CHANGED);
      } finally {
        restoreFails.mockRestore();
      }
    });

    it('sends one resources and skills list_changed for a bundle with no skills that replaces one with skills', async () => {
      published = signed(billingBundle('5.0.0', {}));
      const seen = server.notificationCount();

      const outcome = await server.refresh();

      expect(outcome.status).toBe('applied');
      expect(server.skillIds()).toEqual([]);
      expect(server.listChangedSince(seen)).toEqual(ONE_RESOURCES_AND_SKILLS_LIST_CHANGED);
    });
  });

  describe('on a server whose first pull failed', () => {
    let server: SkilledServer;

    beforeAll(async () => {
      published = 'outage';
      server = await startServer();
    });

    afterAll(async () => {
      await server?.close();
    });

    it('sends nothing for a first bundle that is rolled back, since the skills are still not loaded', async () => {
      published = signed(collidingBundle('0.9.0'));
      const seen = server.notificationCount();

      const outcome = await server.refresh();

      expect(outcome.status).toBe('refused');
      expect(server.skillIds()).toEqual([]);
      expect(server.listChangedSince(seen)).toEqual({});
    });

    it('sends one skills/list_changed when the first bundle loads with no skills, since the skills loaded', async () => {
      published = signed(billingBundle('1.0.0', {}));
      const seen = server.notificationCount();

      const outcome = await server.refresh();

      expect(outcome.status).toBe('applied');
      expect(server.listChangedSince(seen)).toEqual({ 'notifications/skills/list_changed': 1 });
    });
  });
});
