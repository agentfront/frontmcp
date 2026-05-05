// file: libs/sdk/src/skill/skill-audit.helper.ts
//
// Wires the SkillAuditWriter from `@frontmcp/adapters/skills` into the scope
// DI container based on `skillsConfig.audit`. Kept in its own file so the
// scope.instance + skill-scope.helper stay lean.
//
// The helper is structurally typed against the audit module — the SDK does
// NOT import the adapters package (would create a downward → upward cycle).
// Instead, hosts inject the audit module via `setSkillAuditFactory(...)`
// once at boot. This pattern works in Edge runtimes (Cloudflare Workers,
// Vercel Edge) because there is zero `eval`/`require` on the hot path.

import { ProviderScope } from '@frontmcp/di';
import { randomBytes } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../common';
import type { SkillsConfigAuditOptions } from '../common/types/options/skills-http/interfaces';
import type ProviderRegistry from '../provider/provider.registry';

/**
 * Minimal structural shape we need from the audit module. Defined locally so
 * the SDK doesn't take a hard dependency on `@frontmcp/adapters/skills`.
 *
 * Hosts that don't have the adapters package installed will hit a clear
 * runtime error if they enable audit without injecting a factory — we do NOT
 * silently skip audit registration, because that would mask a security
 * configuration error.
 */
export interface AuditModuleShape {
  SkillAuditWriterToken: symbol;
  SkillAuditWriter: new (store: unknown, signer: unknown, logger: FrontMcpLogger, metrics?: unknown) => unknown;
  Hs256AuditSigner: new (secret: string | Uint8Array, keyId: string) => unknown;
  MemoryAuditStore: new () => unknown;
}

/**
 * Factory that returns the audit module. Set once at host bootstrap with
 * {@link setSkillAuditFactory} so the SDK can resolve the module without
 * `eval`/`require` and without taking a hard dependency on the adapters
 * package. This is the Edge-runtime-safe replacement for the previous
 * `eval('require')` shim.
 *
 * @example
 * ```ts
 * import { setSkillAuditFactory } from '@frontmcp/sdk';
 * import * as auditModule from '@frontmcp/adapters/skills';
 *
 * setSkillAuditFactory(() => auditModule);
 * ```
 */
export type SkillAuditFactory = () => AuditModuleShape;

let injectedFactory: SkillAuditFactory | undefined;

/**
 * Register the host-side factory that resolves the audit module. Call once
 * at boot (e.g. in your bootstrap file) before the FrontMCP scope is built.
 *
 * Pass `undefined` to clear the factory (used by tests).
 */
export function setSkillAuditFactory(factory: SkillAuditFactory | undefined): void {
  injectedFactory = factory;
}

/**
 * @internal — used by tests only. Returns whether a factory has been
 * registered.
 */
export function hasSkillAuditFactory(): boolean {
  return typeof injectedFactory === 'function';
}

/**
 * Resolve the audit module via the injected factory, falling back to a
 * dynamic-`import()`-shaped resolver lazily synthesized from
 * `globalThis['__frontmcp_skill_audit_module__']` if the host (e.g. tests)
 * stashed the module there. Returns `undefined` if no path resolves.
 *
 * Edge-runtime-safe: never calls `eval`, never references `require`.
 */
function resolveAuditModule(logger: FrontMcpLogger): AuditModuleShape | undefined {
  if (injectedFactory) {
    try {
      return injectedFactory();
    } catch (e) {
      logger.warn(`[skill-audit] injected SkillAuditFactory threw: ${(e as Error).message}. Audit logging disabled.`);
      return undefined;
    }
  }
  // Optional global escape hatch — useful for tests / late-bound bundles
  // where setting up a top-level factory is awkward. Never relied on in
  // production paths.
  const g = globalThis as unknown as { __frontmcp_skill_audit_module__?: AuditModuleShape };
  if (g.__frontmcp_skill_audit_module__) {
    return g.__frontmcp_skill_audit_module__;
  }
  return undefined;
}

/**
 * True when the runtime appears to be a production deployment. Used to
 * refuse defaulting to a process-local HS256 secret in production — that
 * default is dev-only and silently shipping it would be a security regression.
 */
function isProductionRuntime(): boolean {
  // Read NODE_ENV defensively — in some Edge runtimes `process` is undefined.
  try {
    const env = (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process?.env;
    return env?.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

/**
 * Register the SkillAuditWriter in the scope DI container when
 * `skillsConfig.audit.enabled` is set.
 *
 * Defaults (used only when the host doesn't supply explicit signer/store):
 *   - signer: in-memory HS256 with a randomly generated 32-byte secret
 *     (refused in production — host MUST configure an explicit signer).
 *   - store: in-memory append-only log
 *
 * Both defaults are flagged in the logs as dev-only so production hosts
 * don't accidentally rely on them.
 */
export function registerSkillAuditWriter(options: {
  providers: ProviderRegistry;
  audit: SkillsConfigAuditOptions | undefined;
  logger: FrontMcpLogger;
}): void {
  const { providers, audit, logger } = options;
  if (!audit?.enabled) return;

  const mod = resolveAuditModule(logger);
  if (!mod) {
    // Loud failure — quiet "audit disabled" in production would be a
    // security regression because operators expect their audit log to be
    // present when they set `audit.enabled: true`.
    const msg =
      '[skill-audit] audit.enabled is true but no audit module factory is registered. ' +
      'Call setSkillAuditFactory(() => require("@frontmcp/adapters/skills")) at boot, ' +
      'or supply a signer + store explicitly in skillsConfig.audit.';
    if (isProductionRuntime()) {
      throw new Error(msg);
    }
    logger.warn(msg + ' Audit logging disabled (dev mode).');
    return;
  }

  const signer = audit.signer ?? createDefaultSigner(mod, logger);
  const store = audit.store ?? createDefaultStore(mod, logger);

  const writer = new mod.SkillAuditWriter(store, signer, logger);

  providers.injectProvider({
    provide: mod.SkillAuditWriterToken,
    value: writer,
    metadata: {
      id: 'frontmcp-skill-audit-writer',
      name: 'SkillAuditWriter',
      scope: ProviderScope.GLOBAL,
      description: 'Tamper-evident, hash-chained audit log for skill action invocations.',
    },
  });
  logger.verbose('Registered SkillAuditWriter — skill action audit log enabled');
}

function createDefaultSigner(mod: AuditModuleShape, logger: FrontMcpLogger): unknown {
  // CSPRNG-derived 32-byte secret. Production hosts MUST supply an explicit
  // signer; in production we refuse to fall back to the default at all so
  // a misconfiguration can never silently ship with a process-local secret
  // that's lost on restart.
  if (isProductionRuntime()) {
    throw new Error(
      '[skill-audit] refusing to use the default HS256 signer in production. ' +
        'Configure skillsConfig.audit.signer with a host-managed key (e.g. RS256 ' +
        'pointing at the same key registry your bundle signing uses).',
    );
  }
  const bytes = randomBytes(32);
  logger.warn(
    '[skill-audit] no audit signer configured — using process-local HS256 with a CSPRNG-generated secret. ' +
      'Records signed by this instance cannot be verified after restart. Configure skillsConfig.audit.signer for production.',
  );
  return new mod.Hs256AuditSigner(bytes, 'frontmcp-default-hs256');
}

function createDefaultStore(mod: AuditModuleShape, logger: FrontMcpLogger): unknown {
  logger.warn(
    '[skill-audit] no audit store configured — using in-memory store. ' +
      'Records are lost on restart and not shared across pods. Configure skillsConfig.audit.store for production.',
  );
  return new mod.MemoryAuditStore();
}
