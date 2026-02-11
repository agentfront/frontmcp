/**
 * ~/.frontmcp/registry.json CRUD operations.
 */

import * as fs from 'fs';
import { registryPath, ensurePmDirs } from '../../pm/pm.paths';
import { FrontmcpRegistry } from './types';

function emptyRegistry(): FrontmcpRegistry {
  return { version: 1, apps: {} };
}

export function readRegistry(): FrontmcpRegistry {
  const filePath = registryPath();
  try {
    if (!fs.existsSync(filePath)) return emptyRegistry();
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as FrontmcpRegistry;
  } catch {
    return emptyRegistry();
  }
}

export function writeRegistry(registry: FrontmcpRegistry): void {
  ensurePmDirs();
  const filePath = registryPath();
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf-8');
}

export function registerApp(name: string, data: FrontmcpRegistry['apps'][string]): void {
  const registry = readRegistry();
  registry.apps[name] = data;
  writeRegistry(registry);
}

export function unregisterApp(name: string): boolean {
  const registry = readRegistry();
  if (!registry.apps[name]) return false;
  delete registry.apps[name];
  writeRegistry(registry);
  return true;
}

export function getRegisteredApp(name: string): FrontmcpRegistry['apps'][string] | null {
  const registry = readRegistry();
  return registry.apps[name] || null;
}

export function listRegisteredApps(): Array<{
  name: string;
  data: FrontmcpRegistry['apps'][string];
}> {
  const registry = readRegistry();
  return Object.entries(registry.apps).map(([name, data]) => ({
    name,
    data,
  }));
}
