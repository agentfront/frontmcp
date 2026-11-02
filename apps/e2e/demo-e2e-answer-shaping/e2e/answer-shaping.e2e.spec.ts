/**
 * E2E tests for answer shaping: the answer budget (`output.budget`), client profiles (`clients`),
 * the cost meter on `/metrics`, and `http.forwardHeaders`.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@frontmcp/testing';

const BUDGET_BYTES = 64 * 1024;

function textAt(content: unknown[], index: number): string {
  const block = content[index] as { type?: string; text?: string } | undefined;
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

test.describe('Answer shaping E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-answer-shaping/src/main.ts',
    project: 'demo-e2e-answer-shaping',
    publicMode: true,
  });

  test.describe('answer budget', () => {
    test('fits a 300 KB tool answer to the budget, still valid JSON, newest rows kept', async ({ mcp }) => {
      const result = await mcp.tools.call('big-report', { rows: 1000 });
      expect(result).toBeSuccessful();

      const text = textAt(result.raw.content, 0);
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(BUDGET_BYTES);
      const answer = JSON.parse(text) as { rows: Array<{ id: number }>; total: number };
      expect(answer.total).toBe(1000);
      expect(answer.rows[answer.rows.length - 1].id).toBe(999);
      expect(answer.rows.length).toBeLessThan(1000);
      expect(result.raw.structuredContent).toEqual(answer);

      expect(textAt(result.raw.content, 1)).toBe(
        `This answer was shortened to fit its ${BUDGET_BYTES}-byte budget: ` +
          `left out the first ${1000 - answer.rows.length} of 1000 items of $.rows.`,
      );
      expect(result.raw._meta?.['frontmcp/budget']).toEqual({
        maxBytes: BUDGET_BYTES,
        lists: 'keep-newest',
        omitted: [{ path: '$.rows', items: 1000 - answer.rows.length, of: 1000 }],
      });
    });

    test('leaves an answer within the budget alone', async ({ mcp }) => {
      const result = await mcp.tools.call('big-report', { rows: 5 });
      expect(result.raw.content).toHaveLength(1);
      expect(result.raw._meta?.['frontmcp/budget']).toBeUndefined();
    });

    test('fits a resource read to the budget', async ({ mcp }) => {
      const read = await mcp.resources.read('reports://log');
      const [log, note] = read.raw.contents as Array<{ uri: string; mimeType?: string; text: string }>;

      expect(Buffer.byteLength(log.text, 'utf8')).toBeLessThanOrEqual(BUDGET_BYTES);
      const entries = (JSON.parse(log.text) as { entries: Array<{ id: number }> }).entries;
      expect(entries[entries.length - 1].id).toBe(999);
      expect(note).toEqual({
        uri: 'reports://log',
        mimeType: 'text/plain',
        text: `This answer was shortened to fit its ${BUDGET_BYTES}-byte budget: left out the first ${1000 - entries.length} of 1000 items of $.entries.`,
      });
    });
  });

  test.describe('client profiles', () => {
    test('a client named like a structured: only profile gets a summary in place of the JSON', async ({ server }) => {
      const client = await server.createClient({ clientInfo: { name: 'summary-agent', version: '1.0.0' } });
      await client.tools.list();

      const result = await client.tools.call('big-report', { rows: 3 });

      expect(result).toBeSuccessful();
      expect(result.raw.content).toEqual([
        { type: 'text', text: 'The answer is in structuredContent: rows (3 items), total: 3.' },
      ]);
      expect((result.raw.structuredContent as { total: number }).total).toBe(3);
    });

    test('a structured: text client gets no outputSchema and no structuredContent', async ({ server }) => {
      const client = await server.createClient({ clientInfo: { name: 'text-agent', version: '1.0.0' } });
      const tools = await client.tools.list();
      expect(tools.find((tool) => tool.name === 'big-report')?.outputSchema).toBeUndefined();

      const result = await client.tools.call('big-report', { rows: 2 });

      expect(result.raw.structuredContent).toBeUndefined();
      expect(JSON.parse(textAt(result.raw.content, 0))).toMatchObject({ total: 2 });
    });

    test('another client gets the JSON text and structuredContent', async ({ mcp }) => {
      const result = await mcp.tools.call('big-report', { rows: 2 });
      expect(JSON.parse(textAt(result.raw.content, 0))).toEqual(result.raw.structuredContent);
    });
  });

  test.describe('cost meter', () => {
    test('the answer bytes, estimated tokens and duplicated bytes counters appear on /metrics', async ({
      mcp,
      server,
    }) => {
      await mcp.tools.call('big-report', { rows: 2 });

      const response = await fetch(`${server.info.baseUrl}/metrics`);
      const body = await response.text();

      expect(response.status).toBe(200);
      for (const counter of [
        'frontmcp_tool_answer_bytes_total',
        'frontmcp_tool_answer_estimated_tokens_total',
        'frontmcp_tool_answer_duplicated_bytes_total',
      ]) {
        expect(body).toMatch(new RegExp(`^${counter}\\{client="[a-z-]+",tool="reports:big-report"\\} [1-9]\\d*$`, 'm'));
      }
    });
  });

  test.describe('forwarded headers', () => {
    test('an x-acme-* header reaches a tool through http.forwardHeaders, other headers do not', async ({ server }) => {
      const client = await server
        .createClientBuilder()
        .withHeaders({ 'x-acme-tenant': 'blue', 'x-other': 'dropped' })
        .withPublicMode()
        .buildAndConnect();

      try {
        const result = await client.tools.call('request-headers', {});
        const { customHeaders } = result.json<{ customHeaders: Record<string, string> }>();

        expect(customHeaders['x-acme-tenant']).toBe('blue');
        expect(customHeaders['x-other']).toBeUndefined();
      } finally {
        await client.disconnect();
      }
    });
  });
});

describe('http.forwardHeaders at boot', () => {
  it('refuses authorization before the server starts', () => {
    // A file, not a pipe: Node can exit on the error before a pipe has taken all of its output
    const outputDir = mkdtempSync(join(tmpdir(), 'answer-shaping-refused-'));
    const outputFile = join(outputDir, 'output.txt');
    const outputFd = openSync(outputFile, 'w');
    try {
      const run = spawnSync('npx', ['tsx', join(__dirname, '../src/refused-header.main.ts')], {
        cwd: join(__dirname, '../../../..'),
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', outputFd, outputFd],
        timeout: 60_000,
      });
      const output = readFileSync(outputFile, 'utf8');

      expect(run.status).not.toBe(0);
      expect(output.match(/InvalidDecoratorMetadataError: @FrontMcp invalid metadata for "http"/)?.[0]).toBeDefined();
      expect(
        output.match(/FrontMCP never forwards authorization, cookie, proxy-\* or hop-by-hop headers/)?.[0],
      ).toBeDefined();
    } finally {
      closeSync(outputFd);
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
