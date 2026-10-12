import * as path from 'path';

import { readJSON } from '@frontmcp/utils';

import { resolveConfig, type RegistryCliConfig } from '../../config';
import { resolveEntry } from '../../shared/fs';
import { RegistryError } from './errors';
import type { PackageJsonFields } from './server-json';

export const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io';
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

export interface RegistryProject {
  /** The folder holding the frontmcp.config found above the cwd, else the cwd. */
  projectDir: string;
  registry: RegistryCliConfig;
  entry?: string;
}

export async function loadRegistryProject(cwd: string, configPath?: string): Promise<RegistryProject> {
  const resolved = await resolveConfig({ cwd, mode: 'registry', configPath });
  const projectDir = resolved.configSource === 'search' && resolved.configDir ? resolved.configDir : cwd;
  return { projectDir, registry: resolved.config?.registry ?? {}, entry: resolved.config?.entry };
}

export function resolveRegistryUrl(flag: string | undefined, project: RegistryProject): string {
  const registryUrl = flag ?? project.registry.registryUrl ?? DEFAULT_REGISTRY_URL;
  if (!URL.canParse(registryUrl)) throw new RegistryError(`The registry URL is not a URL: ${registryUrl}`);
  const { protocol, hostname } = new URL(registryUrl);
  const isLocalHttp = protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(hostname);
  if (protocol !== 'https:' && !isLocalHttp) {
    throw new RegistryError(`The registry URL must be HTTPS (http only for localhost): ${registryUrl}`);
  }
  return registryUrl.replace(/\/+$/, '');
}

export async function loadDecoratorConfig(projectDir: string, entry?: string): Promise<Record<string, unknown>> {
  const entryPath = await resolveEntry(projectDir, entry);
  const { loadEntryDecoratorInfo } = await import('../build/load-entry-config.js');
  const { decoratorConfig, loadError } = await loadEntryDecoratorInfo(entryPath);
  if (!decoratorConfig) {
    const reason = loadError ? `: ${loadError}` : '; does it export the @FrontMcp() class?';
    throw new RegistryError(`Could not read @FrontMcp() from ${path.relative(projectDir, entryPath)}${reason}`);
  }
  return decoratorConfig;
}

export async function readPackageJson(projectDir: string): Promise<PackageJsonFields> {
  return (await readJSON<PackageJsonFields>(path.join(projectDir, 'package.json'))) ?? {};
}
