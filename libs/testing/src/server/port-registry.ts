/**
 * @file port-registry.ts
 * @description Centralized port management for E2E tests to prevent port conflicts
 *
 * This module provides:
 * 1. Dedicated port ranges for each E2E test project
 * 2. Port reservation with proper locking (a bound socket inside the process, plus a lock file
 *    that also covers other Jest workers, which each load their own copy of this module)
 * 3. Verification that ports are actually available before assignment
 */

import { createServer, type Server } from 'net';

// ═══════════════════════════════════════════════════════════════════
// PORT RANGE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Port range configuration for E2E test projects.
 * Each project gets a dedicated range of 10 ports to support multiple servers.
 *
 * Base port: 50000 (well above common services)
 * Range size: 10 ports per project
 */
export const E2E_PORT_RANGES = {
  // Core E2E tests (50000-50099)
  'demo-e2e-public': { start: 50000, size: 10 },
  'demo-e2e-cache': { start: 50010, size: 10 },
  'demo-e2e-config': { start: 50020, size: 10 },
  'demo-e2e-direct': { start: 50030, size: 10 },
  'demo-e2e-errors': { start: 50040, size: 10 },
  'demo-e2e-hooks': { start: 50050, size: 10 },
  'demo-e2e-multiapp': { start: 50060, size: 10 },
  'demo-e2e-notifications': { start: 50070, size: 10 },
  'demo-e2e-providers': { start: 50080, size: 10 },
  'demo-e2e-standalone': { start: 50090, size: 10 },

  // Auth E2E tests (50100-50199)
  'demo-e2e-orchestrated': { start: 50100, size: 10 },
  'demo-e2e-transparent': { start: 50110, size: 10 },
  'demo-e2e-cimd': { start: 50120, size: 10 },
  'demo-e2e-remote-proxy': { start: 50130, size: 10 },

  // Feature E2E tests (50200-50299)
  'demo-e2e-skills': { start: 50200, size: 10 },
  'demo-e2e-remote': { start: 50210, size: 10 },
  'demo-e2e-openapi': { start: 50220, size: 10 },
  'demo-e2e-ui': { start: 50230, size: 10 },
  'demo-e2e-codecall': { start: 50240, size: 10 },
  'demo-e2e-remember': { start: 50250, size: 10 },
  'demo-e2e-elicitation': { start: 50260, size: 10 },
  'demo-e2e-agents': { start: 50270, size: 10 },
  'demo-e2e-transport-recreation': { start: 50280, size: 10 },
  'demo-e2e-jobs': { start: 50290, size: 10 },

  // Infrastructure E2E tests (50300-50409)
  'demo-e2e-redis': { start: 50300, size: 10 },
  'demo-e2e-serverless': { start: 50310, size: 10 },
  'demo-e2e-uipack': { start: 50320, size: 10 },
  'demo-e2e-agent-adapters': { start: 50330, size: 10 },
  'demo-e2e-guard': { start: 50340, size: 10 },
  'demo-e2e-cli-exec': { start: 50350, size: 10 },
  'demo-e2e-env-awareness': { start: 50360, size: 10 },
  'demo-e2e-esm': { start: 50370, size: 10 },
  'demo-e2e-feature-flags': { start: 50380, size: 10 },
  'demo-e2e-resource-providers': { start: 50390, size: 10 },

  // ESM E2E tests (50400-50439)
  'esm-package-server': { start: 50400, size: 10 },
  'esm-package-server-hot-reload': { start: 50410, size: 10 },
  'esm-package-server-cli': { start: 50420, size: 10 },
  'demo-e2e-unix-socket': { start: 50430, size: 10 },

  // Distributed E2E tests (50440-50459)
  'demo-e2e-distributed': { start: 50440, size: 20 },

  // Protocol revision E2E tests (50460-50479)
  'demo-e2e-protocol-20260728': { start: 50460, size: 20 },

  // Testing library E2E tests (50480-50499)
  'demo-e2e-testing': { start: 50480, size: 20 },

  // Mock servers and utilities (50900-50999)
  'mock-oauth': { start: 50900, size: 10 },
  'mock-api': { start: 50910, size: 10 },
  'mock-cimd': { start: 50920, size: 10 },

  // Dynamic/unknown projects (51000+)
  default: { start: 51000, size: 100 },
} as const;

export type E2EProject = keyof typeof E2E_PORT_RANGES;

// ═══════════════════════════════════════════════════════════════════
// PORT REGISTRY
// ═══════════════════════════════════════════════════════════════════

/**
 * Track reserved ports with their holder servers
 * The server keeps the port bound until actually used
 */
interface PortReservation {
  port: number;
  project: string;
  holder: Server;
  reservedAt: number;
}

/** Global registry of reserved ports */
const reservedPorts = new Map<number, PortReservation>();

/** Ports whose cross-process lock file this process currently holds */
const lockedPorts = new Set<number>();

/** A lock older than this is treated as abandoned even if its pid was recycled */
const LOCK_MAX_AGE_MS = 10 * 60 * 1000;

interface FsLike {
  mkdirSync(path: string, options: { recursive: boolean }): void;
  writeFileSync(path: string, data: string, options: { flag: string }): void;
  readFileSync(path: string, encoding: 'utf8'): string;
  unlinkSync(path: string): void;
}

function lockDir(): string | undefined {
  try {
    const os = require('node:os');
    const path = require('node:path');
    return path.join(os.tmpdir(), 'frontmcp-testing-ports');
  } catch {
    return undefined;
  }
}

export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Take the cross-process lock for a port. Node-only and best effort: where the filesystem is not
 * available (or not writable) the socket reservation alone is used, as before.
 */
function acquirePortLock(port: number): boolean {
  if (lockedPorts.has(port)) return false;
  let fs: FsLike;
  let file: string;
  try {
    fs = require('node:fs');
    const dir = lockDir();
    if (!dir) return true;
    fs.mkdirSync(dir, { recursive: true });
    file = require('node:path').join(dir, `${port}.lock`);
  } catch {
    return true;
  }

  const payload = JSON.stringify({ pid: process.pid, at: Date.now() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, payload, { flag: 'wx' });
      lockedPorts.add(port);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return true;
      try {
        const held = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; at?: number };
        const fresh = typeof held.at === 'number' && Date.now() - held.at < LOCK_MAX_AGE_MS;
        if (fresh && typeof held.pid === 'number' && pidIsAlive(held.pid)) return false;
        fs.unlinkSync(file);
      } catch {
        // unreadable or already gone: try to take it again
      }
    }
  }
  return false;
}

function releasePortLock(port: number): void {
  if (!lockedPorts.delete(port)) return;
  try {
    const fs: FsLike = require('node:fs');
    const dir = lockDir();
    if (dir) fs.unlinkSync(require('node:path').join(dir, `${port}.lock`));
  } catch {
    // already removed
  }
}

/** Track port index within each project's range */
const projectPortIndex = new Map<string, number>();

/**
 * Get the port range for a project
 */
export function getPortRange(project: string): { start: number; size: number } {
  const key = project as E2EProject;
  if (key in E2E_PORT_RANGES) {
    return E2E_PORT_RANGES[key];
  }
  return E2E_PORT_RANGES.default;
}

/**
 * Reserve a port for a project.
 * Returns a port number and a release function.
 *
 * The port is held by a temporary server until released, preventing race conditions.
 *
 * @param project - E2E project name (used to determine port range)
 * @param preferredPort - Optional specific port to use
 * @returns Object with port number and release function
 */
export async function reservePort(
  project: string,
  preferredPort?: number,
): Promise<{ port: number; release: () => Promise<void>; releaseSocket: () => Promise<void> }> {
  const range = getPortRange(project);

  const handle = (port: number) => ({
    port,
    // Frees the socket only, so the server about to be spawned can bind the port; the lock file stays
    releaseSocket: async () => {
      await releasePort(port);
    },
    release: async () => {
      await releasePort(port);
      releasePortLock(port);
    },
  });

  // `port: 0` (like an omitted port) means "any free port"
  const wantsSpecificPort = preferredPort !== undefined && Number.isInteger(preferredPort) && preferredPort > 0;

  // If a preferred port is specified, try to use it
  if (wantsSpecificPort) {
    const reservation = await tryReservePort(preferredPort, project);
    if (reservation) {
      return handle(preferredPort);
    }
    // If preferred port is not available, fall through to range allocation
    console.warn(`[PortRegistry] Preferred port ${preferredPort} not available for ${project}, allocating from range`);
  }

  // Get the next port index for this project
  let index = projectPortIndex.get(project) ?? 0;
  const maxAttempts = range.size;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = range.start + (index % range.size);
    index = (index + 1) % range.size;

    // Skip if already reserved or locked
    if (reservedPorts.has(port) || lockedPorts.has(port)) {
      continue;
    }

    // Try to reserve this port
    const reservation = await tryReservePort(port, project);
    if (reservation) {
      // Update the index for next allocation
      projectPortIndex.set(project, index);

      return handle(port);
    }
  }

  // If all ports in range are taken, fall back to dynamic allocation
  for (let port = 51000; port < 52000; port++) {
    if (reservedPorts.has(port) || lockedPorts.has(port)) continue;
    if (await tryReservePort(port, project)) {
      return handle(port);
    }
  }

  throw new Error(
    `[PortRegistry] Could not reserve a port for ${project}. ` +
      `Range: ${range.start}-${range.start + range.size - 1}. ` +
      `Currently reserved: ${Array.from(reservedPorts.keys()).join(', ')}`,
  );
}

/**
 * Try to reserve a specific port by binding a temporary server to it
 */
async function tryReservePort(port: number, project: string): Promise<boolean> {
  if (!acquirePortLock(port)) {
    // Another process (or another server of this one) has claimed it
    return false;
  }

  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      // Port is not available
      releasePortLock(port);
      resolve(false);
    });

    // Omit host to match Express default behavior (:: on dual-stack, 0.0.0.0 otherwise)
    server.listen(port, () => {
      // Port is available and now held
      reservedPorts.set(port, {
        port,
        project,
        holder: server,
        reservedAt: Date.now(),
      });
      resolve(true);
    });
  });
}

/**
 * Release a reserved port
 */
async function releasePort(port: number): Promise<void> {
  const reservation = reservedPorts.get(port);
  if (!reservation) {
    return;
  }

  return new Promise((resolve) => {
    reservation.holder.close(() => {
      reservedPorts.delete(port);
      resolve();
    });
  });
}

/**
 * Get the primary port for a project (first port in its range)
 */
export function getProjectPort(project: string): number {
  const range = getPortRange(project);
  return range.start;
}

/**
 * Get all ports for a project (for multi-server scenarios)
 */
export function getProjectPorts(project: string, count: number): number[] {
  const range = getPortRange(project);
  if (count > range.size) {
    throw new Error(`[PortRegistry] Requested ${count} ports but ${project} only has ${range.size} available`);
  }

  const ports: number[] = [];
  for (let i = 0; i < count; i++) {
    ports.push(range.start + i);
  }
  return ports;
}

/**
 * Release all reserved ports (for cleanup in afterAll)
 */
export async function releaseAllPorts(): Promise<void> {
  const releases = Array.from(reservedPorts.keys()).map((port) => releasePort(port));
  await Promise.all(releases);
  for (const port of Array.from(lockedPorts)) {
    releasePortLock(port);
  }
}

/**
 * Get information about currently reserved ports (for debugging)
 */
export function getReservedPorts(): Array<{ port: number; project: string; reservedAt: number }> {
  return Array.from(reservedPorts.values()).map((r) => ({
    port: r.port,
    project: r.project,
    reservedAt: r.reservedAt,
  }));
}
