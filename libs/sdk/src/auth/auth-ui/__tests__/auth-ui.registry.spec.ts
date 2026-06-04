/**
 * Unit tests for {@link AuthUiRegistry} (#469 — map form): slot→file resolution
 * (relative paths anchored to a source dir, absolute pass-through), name→handler
 * extras, CSRF mint/verify (incl. mismatch rejection), and the per-pending-auth
 * accumulator that backs `useAddedItems`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuthExtraHandler } from '@frontmcp/auth';

import { AuthUiRegistry } from '../auth-ui.registry';

/** A real on-disk source dir + login.tsx so file resolution can be asserted. */
function makeSourceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'authui-reg-'));
  writeFileSync(join(dir, 'login.tsx'), 'export default function L(){ return null; }', 'utf-8');
  return dir;
}

/** A simple env-add handler used by the extras tests. */
const addEnvHandler: AuthExtraHandler = (input, ctx) => {
  const key = typeof input['key'] === 'string' ? (input['key'] as string).trim() : '';
  if (!key) return { ok: false, error: 'key is required' };
  if (ctx.current.some((it) => (it as { key?: string })?.key === key)) {
    return { ok: false, error: `"${key}" was already added` };
  }
  return { ok: true, addedItems: [{ key, value: input['value'] ?? null }] };
};

describe('AuthUiRegistry — slot map registration + resolution', () => {
  it('registers a slot from the map and resolves the file against the source dir', () => {
    const dir = makeSourceDir();
    const reg = new AuthUiRegistry();
    reg.registerAuthUiMap({ login: './login.tsx' }, dir);
    expect(reg.hasAny()).toBe(true);
    expect(reg.hasSlot('login')).toBe(true);
    expect(reg.hasSlot('consent')).toBe(false);
    // Relative path anchored to the source dir → absolute.
    expect(reg.getSlotSource('login')).toEqual({ file: join(dir, 'login.tsx') });
    expect(reg.canRenderSlot('login')).toBe(true);
  });

  it('passes an absolute slot path through unchanged', () => {
    const dir = makeSourceDir();
    const abs = join(dir, 'login.tsx');
    const reg = new AuthUiRegistry();
    reg.registerAuthUiMap({ login: abs }, '/some/other/dir');
    expect(reg.getSlotSource('login')).toEqual({ file: abs });
  });

  it('throws on an unknown slot key', () => {
    const reg = new AuthUiRegistry();
    expect(() => reg.registerAuthUiMap({ nope: './x.tsx' } as never, '/dir')).toThrow(Error);
    expect(() => reg.registerAuthUiMap({ nope: './x.tsx' } as never, '/dir')).toThrow(/slot "nope"/);
  });

  it('is a no-op for an undefined / empty map', () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthUiMap(undefined, '/dir');
    expect(reg.hasAny()).toBe(false);
  });

  it('later registration for the same slot wins', () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthUiMap({ login: '/a/login.tsx' }, '/dir');
    reg.registerAuthUiMap({ login: '/b/login.tsx' }, '/dir');
    expect(reg.getSlotSource('login')).toEqual({ file: '/b/login.tsx' });
  });
});

describe('AuthUiRegistry — slot source resolution', () => {
  it('has no source / cannot render an unregistered slot', () => {
    const reg = new AuthUiRegistry();
    expect(reg.canRenderSlot('login')).toBe(false);
    expect(reg.getSlotSource('login')).toBeUndefined();
  });

  it('records + caches a slot build error so a broken file falls back without retry', () => {
    const dir = makeSourceDir();
    const reg = new AuthUiRegistry();
    reg.registerAuthUiMap({ login: './login.tsx' }, dir);
    expect(reg.getSlotSource('login')).toBeDefined();
    reg.recordSlotError('login', 'boom');
    expect(reg.getSlotSource('login')).toBeUndefined();
    expect(reg.canRenderSlot('login')).toBe(false);
  });

  it('round-trips resolver overrides for the page builder', () => {
    const reg = new AuthUiRegistry();
    expect(reg.getResolverOverrides()).toBeUndefined();
    reg.setResolverOverrides({ '@frontmcp/ui/auth': 'http://localhost:5173/ui-auth.mjs' });
    expect(reg.getResolverOverrides()).toEqual({ '@frontmcp/ui/auth': 'http://localhost:5173/ui-auth.mjs' });
  });
});

describe('AuthUiRegistry — extras map registration + routing', () => {
  it('registers an extra handler and routes by name', () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({ 'envs:add': addEnvHandler });
    expect(reg.hasExtras()).toBe(true);
    expect(reg.hasExtra('envs:add')).toBe(true);
    expect(reg.hasExtra('nope')).toBe(false);
  });

  it('throws when an extra value is not a function', () => {
    const reg = new AuthUiRegistry();
    expect(() => reg.registerAuthExtrasMap({ bad: 123 as never })).toThrow(Error);
    expect(() => reg.registerAuthExtrasMap({ bad: 123 as never })).toThrow(/handler function/);
  });

  it('is a no-op for an undefined map', () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap(undefined);
    expect(reg.hasExtras()).toBe(false);
  });
});

describe('AuthUiRegistry — CSRF', () => {
  it('mints a stable token per pending-auth id and verifies it', () => {
    const reg = new AuthUiRegistry();
    const a = reg.mintCsrf('pid-1');
    const b = reg.mintCsrf('pid-1');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(reg.verifyCsrf('pid-1', a)).toBe(true);
  });

  it('rejects a mismatched / missing token', () => {
    const reg = new AuthUiRegistry();
    const token = reg.mintCsrf('pid-2');
    expect(reg.verifyCsrf('pid-2', `${token}x`)).toBe(false);
    expect(reg.verifyCsrf('pid-2', undefined)).toBe(false);
    expect(reg.verifyCsrf(undefined, token)).toBe(false);
    expect(reg.verifyCsrf('unknown', token)).toBe(false);
  });

  it('mints distinct tokens for distinct pending ids', () => {
    const reg = new AuthUiRegistry();
    expect(reg.mintCsrf('a')).not.toBe(reg.mintCsrf('b'));
  });
});

describe('AuthUiRegistry — accumulator + extra routing', () => {
  it('accumulates accepted items and echoes the full map', async () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({ 'envs:add': addEnvHandler });

    const r1 = await reg.runExtra('envs:add', 'pid', { key: 'API_KEY', value: 'x' });
    expect(r1.ok).toBe(true);
    expect(r1.addedItems).toEqual({ 'envs:add': [{ key: 'API_KEY', value: 'x' }] });

    const r2 = await reg.runExtra('envs:add', 'pid', { key: 'DB_URL', value: 'y' });
    expect(r2.ok).toBe(true);
    expect(r2.addedItems).toEqual({
      'envs:add': [
        { key: 'API_KEY', value: 'x' },
        { key: 'DB_URL', value: 'y' },
      ],
    });

    expect(reg.getAddedItems('pid')).toEqual({
      'envs:add': [
        { key: 'API_KEY', value: 'x' },
        { key: 'DB_URL', value: 'y' },
      ],
    });
  });

  it('returns the handler error without mutating the accumulator', async () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({ 'envs:add': addEnvHandler });
    const r = await reg.runExtra('envs:add', 'pid', { key: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/key is required/);
    expect(reg.getAddedItems('pid')['envs:add']).toBeUndefined();
  });

  it('returns ok:false for an unknown extra', async () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({ 'envs:add': addEnvHandler });
    const r = await reg.runExtra('nope', 'pid', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown extra/);
  });

  it('supports an async handler', async () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({
      slow: async (input) => Promise.resolve({ ok: true, addedItems: [{ v: input['v'] }] }),
    });
    const r = await reg.runExtra('slow', 'pid', { v: 1 });
    expect(r.ok).toBe(true);
    expect(r.addedItems).toEqual({ slow: [{ v: 1 }] });
  });

  it('catches a throwing handler and returns a generic failure', async () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({
      boom: () => {
        throw new Error('kaboom');
      },
    });
    const r = await reg.runExtra('boom', 'pid', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/failed/i);
  });

  it('rejects a malformed handler result', async () => {
    const reg = new AuthUiRegistry();
    reg.registerAuthExtrasMap({ weird: () => ({}) as never });
    const r = await reg.runExtra('weird', 'pid', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/failed/i);
  });
});
