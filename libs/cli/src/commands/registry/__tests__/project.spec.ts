import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RegistryError } from '../errors';
import { loadDecoratorConfig, resolveRegistryUrl, type RegistryProject } from '../project';
import { buildServerJson } from '../server-json';
import { validateServerJson } from '../validate';

describe('resolveRegistryUrl', () => {
  const project: RegistryProject = { projectDir: '/project', registry: {} };

  it('defaults to the official Registry and drops trailing slashes', () => {
    expect(resolveRegistryUrl(undefined, project)).toBe('https://registry.modelcontextprotocol.io');
    expect(resolveRegistryUrl('https://staging.registry.modelcontextprotocol.io//', project)).toBe(
      'https://staging.registry.modelcontextprotocol.io',
    );
    expect(resolveRegistryUrl(undefined, { ...project, registry: { registryUrl: 'https://registry.test/' } })).toBe(
      'https://registry.test',
    );
  });

  it.each(['http://127.0.0.1:4100', 'http://localhost:4100', 'http://[::1]:4100'])(
    'allows plain http for the loopback registry %s',
    (registryUrl) => {
      expect(resolveRegistryUrl(registryUrl, project)).toBe(registryUrl);
    },
  );

  it.each(['http://registry.example.com', 'http://127.0.0.2', 'ftp://registry.example.com', 'not a url'])(
    'rejects %s',
    (registryUrl) => {
      expect(() => resolveRegistryUrl(registryUrl, project)).toThrow(RegistryError);
    },
  );

  it('says the registry URL must be HTTPS', () => {
    expect(() => resolveRegistryUrl('http://registry.example.com', project)).toThrow(
      'The registry URL must be HTTPS (http only for localhost): http://registry.example.com',
    );
  });
});

describe('loadDecoratorConfig with a real @FrontMcp() entry', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-project-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('reads the registry option the SDK keeps on the decorated class', async () => {
    const entry = path.join(projectDir, 'main.js');
    fs.writeFileSync(
      entry,
      `const { FrontMcp } = require('@frontmcp/sdk');
class WeatherServer {}
FrontMcp({
  info: { name: 'weather', title: 'Acme Weather', version: '1.2.0' },
  apps: [],
  registry: {
    name: 'com.acme/weather',
    description: 'Forecasts for any city',
    repository: { url: 'https://github.com/acme/weather', source: 'github' },
  },
})(WeatherServer);
module.exports = WeatherServer;
`,
    );

    const decoratorConfig = await loadDecoratorConfig(projectDir, entry);
    const { serverJson } = buildServerJson({
      decoratorConfig,
      packageJson: {},
      remoteUrl: 'https://mcp.acme.com/mcp',
    });

    expect(serverJson).toEqual(
      expect.objectContaining({
        name: 'com.acme/weather',
        description: 'Forecasts for any city',
        version: '1.2.0',
        title: 'Acme Weather',
        repository: { url: 'https://github.com/acme/weather', source: 'github' },
      }),
    );
    expect(validateServerJson(serverJson)).toEqual([]);
  });
});
