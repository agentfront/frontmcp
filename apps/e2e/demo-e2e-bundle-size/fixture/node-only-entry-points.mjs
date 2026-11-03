import { FrontMcpInstance } from '@frontmcp/sdk';

const config = { info: { name: 'node-only', version: '1.0.0' }, apps: [] };

function refusalOf(run) {
  return run().then(
    () => ({ code: 'NONE', message: 'it ran' }),
    (error) => ({ code: error?.code, message: String(error?.message ?? error) }),
  );
}

Promise.all([
  refusalOf(() => FrontMcpInstance.runShared(config, { key: 'page' })),
  refusalOf(() => FrontMcpInstance.runUnixSocket({ ...config, socketPath: '/tmp/frontmcp-page.sock' })),
]).then(([runShared, runUnixSocket]) => self.postMessage({ runShared, runUnixSocket }));
