import { RegistryError } from '../errors';
import {
  buildServerJson,
  domainOfServerName,
  registryServerName,
  repositoryFromPackageJson,
  SERVER_JSON_SCHEMA_URL,
} from '../server-json';

const decoratorConfig = {
  info: {
    name: 'weather',
    title: 'Acme Weather',
    version: '2.0.0',
    websiteUrl: 'https://acme.com/weather',
    icons: [
      { src: 'https://acme.com/icon.png', mimeType: 'image/png', sizes: ['48x48'], theme: 'light' },
      { src: 'data:image/png;base64,AAAA' },
    ],
  },
  registry: { name: 'com.acme/weather', description: 'Forecasts for any city' },
};

const packageJson = {
  name: '@acme/weather-mcp',
  version: '2.0.1',
  description: 'Package description',
  repository: { type: 'git', url: 'git+https://github.com/acme/weather-mcp.git', directory: 'apps/weather' },
};

describe('buildServerJson', () => {
  it('combines @FrontMcp({ info, registry }), package.json, the remote URL, and the npm package', () => {
    const { serverJson } = buildServerJson({
      decoratorConfig,
      packageJson,
      remoteUrl: 'https://mcp.acme.com/mcp',
      packages: ['npm'],
    });
    expect(serverJson).toEqual({
      $schema: SERVER_JSON_SCHEMA_URL,
      name: 'com.acme/weather',
      description: 'Forecasts for any city',
      version: '2.0.0',
      title: 'Acme Weather',
      websiteUrl: 'https://acme.com/weather',
      icons: [{ src: 'https://acme.com/icon.png', mimeType: 'image/png', sizes: ['48x48'], theme: 'light' }],
      repository: { url: 'https://github.com/acme/weather-mcp', source: 'github', subfolder: 'apps/weather' },
      remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.com/mcp' }],
      packages: [
        { registryType: 'npm', identifier: '@acme/weather-mcp', version: '2.0.1', transport: { type: 'stdio' } },
      ],
    });
  });

  it('warns about each icon it leaves out because its src is not https', () => {
    const { warnings } = buildServerJson({ decoratorConfig, packageJson });
    expect(warnings).toEqual(['Left out the icon data:image/png;base64,AAAA: the Registry lists only https icons.']);
    expect(buildServerJson({ decoratorConfig: { registry: decoratorConfig.registry }, packageJson }).warnings).toEqual(
      [],
    );
  });

  it('falls back to package.json for the description, version and repository', () => {
    const { serverJson } = buildServerJson({
      decoratorConfig: { registry: { name: 'com.acme/weather' } },
      packageJson,
    });
    expect(serverJson).toEqual({
      $schema: SERVER_JSON_SCHEMA_URL,
      name: 'com.acme/weather',
      description: 'Package description',
      version: '2.0.1',
      repository: { url: 'https://github.com/acme/weather-mcp', source: 'github', subfolder: 'apps/weather' },
    });
  });

  it('prefers registry.repository from the decorator over package.json', () => {
    const { serverJson } = buildServerJson({
      decoratorConfig: {
        ...decoratorConfig,
        registry: { ...decoratorConfig.registry, repository: { url: 'https://gitlab.com/acme/w', source: 'gitlab' } },
      },
      packageJson,
    });
    expect(serverJson.repository).toEqual({ url: 'https://gitlab.com/acme/w', source: 'gitlab' });
  });

  it('explains what to set when the name, description or version is missing', () => {
    expect(() => buildServerJson({ decoratorConfig: { info: {} }, packageJson })).toThrow(/registry: \{ name:/);
    expect(() => buildServerJson({ decoratorConfig: { registry: { name: 'com.acme/w' } }, packageJson: {} })).toThrow(
      /registry.description/,
    );
    expect(() =>
      buildServerJson({ decoratorConfig: { registry: { name: 'com.acme/w', description: 'd' } }, packageJson: {} }),
    ).toThrow(/info.version/);
    expect(() => buildServerJson({ decoratorConfig: {}, packageJson })).toThrow(RegistryError);
  });

  it('needs the package name and version to list the npm package', () => {
    expect(() => buildServerJson({ decoratorConfig, packageJson: { description: 'd' }, packages: ['npm'] })).toThrow(
      /needs name and version in package.json/,
    );
  });
});

describe('registryServerName / domainOfServerName', () => {
  it('reads registry.name and reverses the namespace into the proof domain', () => {
    expect(registryServerName(decoratorConfig)).toBe('com.acme/weather');
    expect(domainOfServerName('com.acme/weather')).toBe('acme.com');
    expect(domainOfServerName('com.acme.mcp/weather')).toBe('mcp.acme.com');
  });
});

describe('repositoryFromPackageJson', () => {
  it.each([
    ['https://github.com/acme/repo', { url: 'https://github.com/acme/repo', source: 'github' }],
    ['git+https://github.com/acme/repo.git', { url: 'https://github.com/acme/repo', source: 'github' }],
    ['git@github.com:acme/repo.git', { url: 'https://github.com/acme/repo', source: 'github' }],
    ['github:acme/repo', { url: 'https://github.com/acme/repo', source: 'github' }],
    ['https://gitlab.com/acme/repo', { url: 'https://gitlab.com/acme/repo', source: 'gitlab' }],
  ])('maps %s', (url, expected) => {
    expect(repositoryFromPackageJson(url)).toEqual(expected);
  });

  it.each([['https://bitbucket.org/acme/repo'], ['https://notgithub.com/acme/repo'], [undefined], [{ type: 'git' }]])(
    'skips %p, which the Registry cannot list',
    (repository) => {
      expect(repositoryFromPackageJson(repository)).toBeUndefined();
    },
  );
});
