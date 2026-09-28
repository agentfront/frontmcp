import 'reflect-metadata';

import {
  createTestFetchServer,
  createTestJwtIssuer,
  type TestFetchServer,
  type TestJwtIssuer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Skill, SkillContext, type FrontMcpConfigInput } from '../../../common';

/**
 * The skills HTTP endpoints (#268):
 * - `skillsConfig.auth: 'inherit'` (the default) applies the server's own auth;
 * - `/llm.txt` and `/llm_full.txt` leave out skills whose `authorities` the caller doesn't satisfy,
 *   like `/skills` already did.
 */

@Skill({ name: 'onboarding', description: 'Onboarding guide', instructions: 'Onboarding steps.' })
class OnboardingSkill extends SkillContext {}

@Skill({
  name: 'refund-playbook',
  description: 'How to issue refunds',
  instructions: 'Refund secret steps.',
  authorities: 'admin',
})
class RefundPlaybookSkill extends SkillContext {}

@App({ id: 'desk', name: 'Desk', skills: [OnboardingSkill, RefundPlaybookSkill] })
class DeskApp {}

const STATIC_KEY = 'sk-desk-static-key-0001';
const authorities = { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } };
const PATHS = ['/skills', '/llm.txt', '/llm_full.txt'] as const;

async function get(server: TestFetchServer, path: string, headers: Record<string, string> = {}) {
  const response = await server.handler(new Request(new URL(path, 'http://localhost'), { headers }));
  return { status: response.status, body: await response.text() };
}

describe('skills HTTP endpoints on a static-auth server', () => {
  function staticServer(skillsConfig: FrontMcpConfigInput['skillsConfig']): Promise<TestFetchServer> {
    return createTestFetchServer({
      info: { name: 'skills-http-auth', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'static', tokens: [STATIC_KEY] },
      authorities,
      skillsConfig,
    });
  }

  describe('with the default auth ("inherit")', () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await staticServer({ enabled: true });
    });

    it('refuses a request without the server key', async () => {
      const statuses = await Promise.all(PATHS.map(async (path) => (await get(server, path)).status));

      expect(statuses).toEqual([401, 401, 401]);
    });

    it('refuses a request with a wrong key', async () => {
      const statuses = await Promise.all(
        PATHS.map(async (path) => (await get(server, path, { authorization: 'Bearer nope' })).status),
      );

      expect(statuses).toEqual([401, 401, 401]);
    });

    it('serves a request with the server key, without the skills its caller may not see', async () => {
      const responses = await Promise.all(
        PATHS.map((path) => get(server, path, { authorization: `Bearer ${STATIC_KEY}` })),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(responses.map((response) => response.body.includes('onboarding'))).toEqual([true, true, true]);
      expect(responses.map((response) => response.body.includes('refund-playbook'))).toEqual([false, false, false]);
      expect(responses[2].body).not.toContain('Refund secret steps.');
    });

    it('answers GET /skills/<id> for a skill its caller may not see as not found', async () => {
      const { status, body } = await get(server, '/skills/refund-playbook', { authorization: `Bearer ${STATIC_KEY}` });

      expect(status).toBe(404);
      expect(body).not.toContain('Refund secret steps.');
    });
  });

  describe('in production without MCP_SESSION_SECRET', () => {
    // The skills HTTP endpoints are plain requests, not MCP sessions: verifying their caller must not
    // mint a session id, which needs MCP_SESSION_SECRET in production.
    const saved: Record<string, string | undefined> = {};
    let server: TestFetchServer;

    beforeAll(async () => {
      for (const key of ['NODE_ENV', 'MCP_SESSION_SECRET']) saved[key] = process.env[key];
      process.env['NODE_ENV'] = 'production';
      delete process.env['MCP_SESSION_SECRET'];
      server = await staticServer({ enabled: true });
    });

    afterAll(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('serves a request with the server key', async () => {
      const responses = await Promise.all(
        PATHS.map((path) => get(server, path, { authorization: `Bearer ${STATIC_KEY}` })),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    });

    it('still refuses a request without the server key', async () => {
      const statuses = await Promise.all(PATHS.map(async (path) => (await get(server, path)).status));

      expect(statuses).toEqual([401, 401, 401]);
    });
  });

  describe('with auth "public"', () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await staticServer({ enabled: true, auth: 'public' });
    });

    it('serves anyone, without the skills gated by authorities', async () => {
      const responses = await Promise.all(PATHS.map((path) => get(server, path)));

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(responses.map((response) => response.body.includes('refund-playbook'))).toEqual([false, false, false]);
      expect(responses[2].body).not.toContain('Refund secret steps.');
    });
  });
});

describe('skills HTTP endpoints with auth "bearer"', () => {
  const SKILLS_ISSUER = 'https://skills-idp.example.com';
  const realFetch = globalThis.fetch;
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer(SKILLS_ISSUER);
    // The endpoint fetches the issuer's JWKS from `<issuer>/.well-known/jwks.json`.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `${SKILLS_ISSUER}/.well-known/jwks.json`) return Response.json(issuer.jwks);
      return realFetch(input, init);
    }) as typeof fetch;
    server = await createTestFetchServer({
      info: { name: 'skills-http-auth-bearer', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'public' },
      authorities,
      skillsConfig: { enabled: true, auth: 'bearer', jwt: { issuer: SKILLS_ISSUER } },
    });
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('serves a request with a token from the configured issuer', async () => {
    const token = await issuer.sign({}, 'ada');

    const statuses = await Promise.all(
      PATHS.map(async (path) => (await get(server, path, { authorization: `Bearer ${token}` })).status),
    );

    expect(statuses).toEqual([200, 200, 200]);
  });

  it('refuses a token without exp, which would never expire', async () => {
    const token = await issuer.sign({}, 'ada', { exp: false });

    const statuses = await Promise.all(
      PATHS.map(async (path) => (await get(server, path, { authorization: `Bearer ${token}` })).status),
    );

    expect(statuses).toEqual([401, 401, 401]);
  });
});

describe('skills HTTP endpoints on a transparent-auth server (default auth "inherit")', () => {
  let issuer: TestJwtIssuer;
  let server: TestFetchServer;

  beforeAll(async () => {
    issuer = await createTestJwtIssuer();
    server = await createTestFetchServer({
      info: { name: 'skills-http-auth-transparent', version: '1.0.0' },
      apps: [DeskApp],
      auth: { mode: 'transparent', provider: issuer.issuer, providerConfig: { jwks: issuer.jwks } },
      authorities,
      skillsConfig: { enabled: true },
    });
  });

  it('refuses a request without a token', async () => {
    const statuses = await Promise.all(PATHS.map(async (path) => (await get(server, path)).status));

    expect(statuses).toEqual([401, 401, 401]);
  });

  it('evaluates skill authorities against the verified token', async () => {
    const admin = { authorization: `Bearer ${await issuer.sign({ roles: ['admin'] }, 'ada')}` };
    const member = { authorization: `Bearer ${await issuer.sign({ roles: ['member'] }, 'max')}` };

    const forAdmin = await get(server, '/llm_full.txt', admin);
    const forMember = await get(server, '/llm_full.txt', member);

    expect({
      admin: forAdmin.body.includes('Refund secret steps.'),
      member: forMember.body.includes('Refund secret steps.'),
    }).toEqual({ admin: true, member: false });
  });
});
