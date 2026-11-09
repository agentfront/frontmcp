/**
 * `@Flow({ access })` over Express in public mode: public mode admits anonymous callers, so an `'authorized'` flow
 * runs for them as a `'public'` one does, with the anonymous identity `session:verify` gives them.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('@Flow({ access }) in public mode', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-public/src/main.ts',
    project: 'demo-e2e-public',
    publicMode: true,
    env: { JWT_SECRET: 'public-e2e-shared-secret-0123456789abc' },
  });

  test('answers a public flow without a token', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/flow-access/public`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: null });
  });

  test('runs an authorized flow for an anonymous caller, who gets an anonymous identity', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/flow-access/authorized`);

    expect(response.status).toBe(200);
    expect((await response.json()) as { sub: string }).toEqual({ sub: expect.stringMatching(/^anon:/) });
  });

  test('runs an authorized flow a public route runs for an anonymous caller', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/flow-access/runs-caller`);

    expect(response.status).toBe(200);
    expect((await response.json()) as { sub: string }).toEqual({ sub: expect.stringMatching(/^anon:/) });
  });
});
