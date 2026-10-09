/**
 * E2E: observability in an ES-module project records failures as the client got them (#802).
 *
 * Node loads @frontmcp/sdk's ESM bundle in such a project, and the SDK loads @frontmcp/observability
 * with `require()`: its CommonJS bundle, which loads the SDK's CommonJS bundle, a second copy of every
 * SDK class. Observability's `instanceof FlowControl` and `toMcpError()` did not recognise the ESM
 * copy's classes, so the request log recorded a `PublicMcpError` as `GenericServerError` with a new
 * error id, and the span's exception carried `FlowControl`'s stack. The script
 * (`fixture/esm-project/observability.mjs`) runs with plain `node` on the built packages.
 */
import * as path from 'node:path';

import { readJSON, rm, runCmd } from '@frontmcp/utils';

import { createEsmProject } from './helpers/esm-project';

const FRONTMCP_PACKAGES = ['sdk', 'observability', 'utils', 'protocol', 'di', 'lazy-zod', 'auth', 'guard'];
const THIRD_PARTY = ['reflect-metadata', 'zod', '@opentelemetry'];

interface ClientAnswer {
  errorId?: string;
  text?: string;
}

interface ScriptResult {
  client: { close: ClientAnswer; reopen: ClientAnswer };
  requestLogs: Array<{ type: string; message: string; code: string; error_id: string } | undefined>;
  exceptions: { close: Array<{ message: string; stack: string }> };
}

describe('ES-module project: observability on the built packages', () => {
  let projectDir: string;
  let result: ScriptResult;

  beforeAll(async () => {
    projectDir = await createEsmProject({ frontmcpPackages: FRONTMCP_PACKAGES, thirdParty: THIRD_PARTY });
    const resultFile = path.join(projectDir, 'result.json');
    await runCmd('node', ['observability.mjs'], { cwd: projectDir, env: { ...process.env, RESULT_FILE: resultFile } });
    const written = await readJSON<ScriptResult>(resultFile);
    if (!written) throw new Error('observability.mjs wrote no result');
    result = written;
  }, 120000);

  afterAll(async () => {
    if (projectDir) await rm(projectDir, { recursive: true, force: true });
  });

  it('records a PublicMcpError passed to this.fail() with the message and error id the client got', () => {
    const { close } = result.client;

    expect(close.text).toBe('no such ticket');
    expect(result.requestLogs[0]).toEqual({
      type: 'PublicMcpError',
      message: 'no such ticket',
      code: 'PUBLIC_ERROR',
      error_id: close.errorId,
    });
  });

  it('records a thrown error with the error id the client got', () => {
    const { reopen } = result.client;

    expect(reopen.errorId).toEqual(expect.stringMatching(/^err_/));
    expect(result.requestLogs[1]?.error_id).toBe(reopen.errorId);
    expect(result.requestLogs[1]?.type).not.toBe('GenericServerError');
  });

  it("puts the real error on the span's exception, not FlowControl's stack", () => {
    expect(result.exceptions.close.length).toBeGreaterThan(0);
    for (const exception of result.exceptions.close) {
      expect(exception).toEqual({ message: 'no such ticket', stack: 'PublicMcpError: no such ticket' });
    }
  });
});
