/**
 * E2E: a tool's outputSchema is a contract. Fields execute() returns beyond it must never reach the
 * client, and that includes the response a tool with a `ui` config builds (issue #645).
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Tool UI output sanitization E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  for (const [label, clientInfo] of [
    ['OpenAI', { name: 'ChatGPT', version: '1.0.0' }],
    ['Claude', { name: 'claude-desktop', version: '1.0.0' }],
  ] as const) {
    test(`${label}: undeclared output fields are stripped from content, structuredContent and the widget`, async ({
      server,
    }) => {
      const client = await server.createClient({ transport: 'streamable-http', clientInfo });
      try {
        const result = await client.tools.call('leaky-report', { title: 'Q3' });
        expect(result).toBeSuccessful();

        expect(JSON.stringify(result.raw)).not.toContain('sk-do-not-leak');
        expect(JSON.stringify(result.raw)).not.toContain('internalToken');
        expect(result.json<{ title: string; total: number }>()).toMatchObject({ title: 'Q3', total: 3 });
      } finally {
        await client.disconnect();
      }
    });
  }

  test('ui.csp origins reach the CSP of the rendered widget page', async ({ server }) => {
    const client = await server.createClient({
      transport: 'streamable-http',
      clientInfo: { name: 'ChatGPT', version: '1.0.0' },
    });
    try {
      const result = await client.tools.call('leaky-report', { title: 'Q3' });
      const html = String(result.raw._meta?.['ui/html']);
      const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';

      expect(policy).toContain('connect-src');
      expect(policy).toContain('https://api.leaky-report.example');
    } finally {
      await client.disconnect();
    }
  });
});
