// Scenario B7: a server that installs the Skilled OpenAPI plugin twice refuses to start, and says why.
import { TestServer } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';

const environment = new ProductionEnvironment();

beforeAll(() => environment.start());
afterAll(() => environment.stop());

describe('a server that installs the plugin twice', () => {
  it('fails at startup: one plugin per server, and one bundle can describe several services', async () => {
    const started = TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-skilled-openapi/src/two-plugins.main.ts',
      env: environment.env,
      startupTimeout: 30_000,
    });

    await expect(started).rejects.toThrow(
      'Plugin "skilled-openapi" can be installed once per server, and this server installs it twice. ' +
        'One bundle can describe several services',
    );
  });
});
