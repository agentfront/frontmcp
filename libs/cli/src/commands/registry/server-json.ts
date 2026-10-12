import { RegistryError } from './errors';

export const SERVER_JSON_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

export interface ServerIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: string;
}

export interface ServerRepository {
  url: string;
  source: string;
  subfolder?: string;
}

export interface ServerRemote {
  type: 'streamable-http';
  url: string;
}

export interface ServerPackage {
  registryType: 'npm';
  identifier: string;
  version: string;
  transport: { type: 'stdio' };
}

export interface ServerJson {
  $schema: string;
  name: string;
  description: string;
  version: string;
  title?: string;
  websiteUrl?: string;
  icons?: ServerIcon[];
  repository?: ServerRepository;
  remotes?: ServerRemote[];
  packages?: ServerPackage[];
}

export interface PackageJsonFields {
  name?: string;
  version?: string;
  description?: string;
  repository?: unknown;
  mcpName?: string;
}

export interface BuiltServerJson {
  serverJson: ServerJson;
  warnings: string[];
}

export interface ServerJsonSources {
  decoratorConfig: Record<string, unknown>;
  packageJson: PackageJsonFields;
  remoteUrl?: string;
  packages?: ReadonlyArray<'npm'>;
}

const REPOSITORY_URL_PATTERN = /(?:^|[/@])(?:www\.)?(github|gitlab)\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
const REPOSITORY_SHORTHAND_PATTERN = /^(github|gitlab):([\w.-]+)\/([\w.-]+)$/;

export function buildServerJson(sources: ServerJsonSources): BuiltServerJson {
  const registry = asRecord(sources.decoratorConfig['registry']);
  const info = asRecord(sources.decoratorConfig['info']);
  const { packageJson } = sources;
  const name = registryServerName(sources.decoratorConfig);
  const description = stringField(registry, 'description') ?? packageJson.description;
  if (!description) {
    throw new RegistryError(
      'Set registry.description in @FrontMcp() (1-100 characters) or description in package.json.',
    );
  }
  const version = stringField(info, 'version') ?? packageJson.version;
  if (!version) {
    throw new RegistryError('Set info.version in @FrontMcp() or version in package.json.');
  }
  const title = stringField(info, 'title');
  const websiteUrl = stringField(info, 'websiteUrl');
  const iconEntries = Array.isArray(info['icons']) ? info['icons'].map(asRecord) : [];
  const icons = iconEntries.filter(isHttpsIcon).map(toServerIcon);
  const warnings = iconEntries
    .filter((icon) => !isHttpsIcon(icon))
    .map((icon) => `Left out the icon ${String(icon['src'])}: the Registry lists only https icons.`);
  const repository =
    repositoryFromDecorator(registry['repository']) ?? repositoryFromPackageJson(packageJson.repository);
  const serverJson: ServerJson = {
    $schema: SERVER_JSON_SCHEMA_URL,
    name,
    description,
    version,
    ...(title && { title }),
    ...(websiteUrl && { websiteUrl }),
    ...(icons.length > 0 && { icons }),
    ...(repository && { repository }),
    ...(sources.remoteUrl && { remotes: [{ type: 'streamable-http' as const, url: sources.remoteUrl }] }),
    ...(sources.packages?.includes('npm') && { packages: [npmPackage(packageJson)] }),
  };
  return { serverJson, warnings };
}

export function registryServerName(decoratorConfig: Record<string, unknown>): string {
  const name = stringField(asRecord(decoratorConfig['registry']), 'name');
  if (!name) {
    throw new RegistryError(
      "Set @FrontMcp({ registry: { name: 'com.example/my-server', description: '...' } }) in the entry: " +
        'the name is the reverse-DNS namespace you prove (com.example = example.com) and a server name.',
    );
  }
  return name;
}

export function domainOfServerName(serverName: string): string {
  return reverseDomain(serverName.split('/')[0]);
}

export function reverseDomain(domain: string): string {
  return domain.split('.').reverse().join('.');
}

export function repositoryFromPackageJson(repository: unknown): ServerRepository | undefined {
  const raw = typeof repository === 'string' ? { url: repository } : asRecord(repository);
  const url = stringField(raw, 'url');
  const match = url && (REPOSITORY_SHORTHAND_PATTERN.exec(url) ?? REPOSITORY_URL_PATTERN.exec(url));
  if (!match) return undefined;
  const [, source, owner, repo] = match;
  const subfolder = stringField(raw, 'directory');
  return { url: `https://${source}.com/${owner}/${repo}`, source, ...(subfolder && { subfolder }) };
}

function repositoryFromDecorator(repository: unknown): ServerRepository | undefined {
  const raw = asRecord(repository);
  const url = stringField(raw, 'url');
  const source = stringField(raw, 'source');
  if (!url || !source) return undefined;
  const subfolder = stringField(raw, 'subfolder');
  return { url, source, ...(subfolder && { subfolder }) };
}

function npmPackage(packageJson: PackageJsonFields): ServerPackage {
  if (!packageJson.name || !packageJson.version) {
    throw new RegistryError("registry.packages: ['npm'] needs name and version in package.json.");
  }
  return {
    registryType: 'npm',
    identifier: packageJson.name,
    version: packageJson.version,
    transport: { type: 'stdio' },
  };
}

function isHttpsIcon(icon: Record<string, unknown>): boolean {
  return stringField(icon, 'src')?.startsWith('https://') ?? false;
}

function toServerIcon({ src, mimeType, sizes, theme }: Record<string, unknown>): ServerIcon {
  return {
    src: src as string,
    ...(typeof mimeType === 'string' && { mimeType }),
    ...(Array.isArray(sizes) && { sizes: sizes as string[] }),
    ...(typeof theme === 'string' && { theme }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
