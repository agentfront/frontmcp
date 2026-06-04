/**
 * FrontMcpInstance.runStdio() input resolution (#450).
 *
 * runStdio accepts either a `@FrontMcp`-decorated class or the config object.
 * A plain class with no `@FrontMcp` metadata is a misuse and must fail fast
 * with a guiding error. The resolve step runs FIRST in runStdio — before any
 * global side effects (console redirection, the stdio connection) — so this
 * error path is safe to assert without hijacking the test runner's stdio.
 *
 * The happy paths (class + config object actually serving over stdio) are
 * covered by the e2e suites (apps/e2e/demo-e2e-stdio-transport,
 * apps/e2e/demo-e2e-cli-exec).
 */
import 'reflect-metadata';

import { InternalMcpError } from '../../errors';
import { FrontMcpInstance } from '../front-mcp';

describe('FrontMcpInstance.runStdio — input resolution (#450)', () => {
  it('rejects a class with no @FrontMcp() metadata with a guiding error', async () => {
    class NotDecorated {}

    const err = await FrontMcpInstance.runStdio(NotDecorated as never).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InternalMcpError);
    expect((err as Error).message).toMatch(/without @FrontMcp\(\) metadata/);
  });
});
