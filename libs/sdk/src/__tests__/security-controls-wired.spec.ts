/**
 * Every security control must be reachable from the code that runs.
 *
 * Four of the twelve advisories closed in PR #550 were the same shape: a control that
 * exists, is configurable, is unit-tested — and is wired to nothing. `ToolAccessControlService`,
 * `directCalls.*`, `GuardManager.checkIpFilter()` and `ipFilter.trustProxy` each looked
 * configured and enforced nothing. A unit test proves a control *works*; only a reference from
 * production code proves it *runs*.
 *
 * Two rules, because the two shapes fail differently:
 *
 *  1. A security **service or class** is called across package boundaries, so it is wired if any
 *     production file anywhere references it.
 *  2. An **enforcement method** is wired only if *every* path that needs it calls it. "Some caller
 *     exists" is too weak: GHSA-6w3j was `codecall:execute` consulting the policy while
 *     `codecall:invoke` did not, and a check that counted callers would have stayed green.
 *
 * Known-unwired controls are listed below rather than hidden. The list is the inventory of this
 * debt; anything that falls out of wiring and is not on it fails here immediately.
 *
 * What this does NOT catch, stated so nobody mistakes a green run for proof:
 *
 *  - A service re-exported from a barrel `index.ts` counts as referenced, so one that is
 *    exported and never used still looks alive. The enforcement-method rule exists partly to
 *    cover that gap for the controls that matter most.
 *  - A control that is called but called wrongly — the call site is proof of reachability, not
 *    of correctness. That is what the per-advisory regression specs are for.
 *  - An unread **config field**. A third rule matched schema fields and searched the declaring
 *    package for a reader; it was dropped for being wrong in both directions. It saw only fields
 *    written `name: z.…`, so every field composed from a named schema was invisible — seven of
 *    them in guard's schema alone, `partitionBy` and `ipFilter` among them. A package-scoped
 *    search cannot see a field read from another package, so it called `defaultTimeout.executeMs`
 *    unwired while `call-tool.flow.ts` reads it on every tool call. Widening the search to the
 *    repo trades that for the opposite failure: `trustProxy` passes on an unrelated option of the
 *    same name in `metadata.utils.ts`, which is the exact bug GHSA-hwfp was. A rule that both
 *    misses real gaps and manufactures false ones teaches reviewers to ignore it.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { readFileSync } from '@frontmcp/utils';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/** Directories whose exported services are security controls. */
const CONTROL_DIRS = [
  'libs/guard/src',
  'libs/auth/src',
  'libs/sdk/src/auth',
  'libs/sdk/src/context',
  'plugins/plugin-codecall/src/security',
  'plugins/plugin-codecall/src/services',
  'plugins/plugin-approval/src',
  'plugins/plugin-feature-flags/src',
];

/**
 * Enforcement entry points: methods that must be called from outside the class that defines them.
 *
 * A class-level check cannot see these. `GuardManager` is referenced all over the place, so
 * `GuardManager.checkIpFilter()` could be — and for a while was — implemented, unit-tested and
 * called by nothing, with the class around it looking perfectly alive. That was GHSA-hwfp.
 *
 * `calledFrom` names every path that must make the call, not just one.
 *
 * This list is deliberately hand-maintained. "Security-critical" is a judgement, not something a
 * scanner can infer, and the cost of keeping it current is the point: adding an enforcement
 * method means saying so here.
 */
const CONTROL_METHODS = [
  {
    method: 'checkIpFilter',
    declaredIn: 'libs/guard/src/manager/guard.manager.ts',
    calledFrom: ['libs/sdk/src/scope/flows/http.request.flow.ts'],
  },
  {
    method: 'checkCodeCallToolAccess',
    declaredIn: 'plugins/plugin-codecall/src/security/codecall-tool-policy.ts',
    calledFrom: [
      'plugins/plugin-codecall/src/tools/execute.tool.ts',
      'plugins/plugin-codecall/src/tools/invoke.tool.ts',
    ],
  },
];

/**
 * Controls that are deliberately not wired, each with the reason.
 *
 * Adding an entry is a decision to ship an inert security control, so it needs a reason a
 * reviewer can weigh — not a name.
 */
const KNOWN_UNWIRED_SERVICES: Record<string, string> = {
  ToolAccessControlService:
    'Superseded by codecall-tool-policy.ts, which both meta-tools consult. Kept for its own ' +
    'tests only; wiring it in or deleting it is a breaking change of its own (PR #550).',
  AuditLoggerService: 'Implemented and unit-tested, never registered by CodeCallPlugin (providers: []).',
  ErrorEnrichmentService: 'Implemented and unit-tested, never registered by CodeCallPlugin (providers: []).',
};

/**
 * Not every exported class is a control this rule can judge.
 *
 * A `*.flow.ts` class is dispatched by flow name through the registry — `runFlow('auth:verify')`
 * — so no production file names the class, and a reference check cannot see that it is wired.
 * Errors are thrown where they are declared; fixtures are test scaffolding.
 */
function isExempt(name: string, file: string): boolean {
  return (
    name.endsWith('Error') ||
    file.endsWith('.flow.ts') ||
    file.includes('__test-utils__') ||
    file.includes('/fixtures/')
  );
}

function gitFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.ts'], { cwd: REPO_ROOT, encoding: 'utf-8' }).split('\n').filter(Boolean);
}

function isProductionFile(file: string): boolean {
  return !file.includes('__tests__') && !file.endsWith('.spec.ts') && !file.includes('/dist/');
}

const productionFiles = gitFiles().filter(isProductionFile);
const productionText = new Map<string, string>(productionFiles.map((file) => [file, readFileSync(join(REPO_ROOT, file))]));

function mentions(text: string | undefined, name: string): boolean {
  return text !== undefined && new RegExp(`\\b${name}\\b`).test(text);
}

function referencedOutside(name: string, declaringFile: string): boolean {
  for (const [file, text] of productionText) {
    if (file === declaringFile) continue;
    if (mentions(text, name)) return true;
  }
  return false;
}

describe('security controls are wired to the code that runs', () => {
  describe('services', () => {
    const declarations = [...productionText]
      .filter(([file]) => CONTROL_DIRS.some((dir) => file.startsWith(dir)))
      .flatMap(([file, text]) =>
        [...text.matchAll(/^export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm)]
          .map((match) => ({ name: match[1] as string, file }))
          .filter(({ name }) => !isExempt(name, file)),
      );

    it('finds security services to check', () => {
      expect(declarations.length).toBeGreaterThan(5);
    });

    it.each(declarations)('$name is referenced by production code', ({ name, file }) => {
      if (name in KNOWN_UNWIRED_SERVICES) return;

      expect(referencedOutside(name, file)).toBe(true);
    });

    it('no exemption has gone stale', () => {
      // A stale exemption is as misleading as a missing one: once someone wires the control up,
      // this makes them delete the entry rather than leave it claiming the control is inert.
      const stale = Object.keys(KNOWN_UNWIRED_SERVICES).filter((name) => {
        const declaration = declarations.find((entry) => entry.name === name);
        return !declaration || referencedOutside(name, declaration.file);
      });

      expect(stale).toEqual([]);
    });
  });

  describe('enforcement methods', () => {
    it('finds the declared entry points', () => {
      const missing = CONTROL_METHODS.filter(
        ({ method, declaredIn }) => !mentions(productionText.get(declaredIn), method),
      ).map(({ method, declaredIn }) => `${method} in ${declaredIn}`);

      expect(missing).toEqual([]);
    });

    it.each(CONTROL_METHODS)('$method is called from every path that needs it', ({ method, calledFrom }) => {
      const notCalling = calledFrom.filter((file) => !mentions(productionText.get(file), method));

      expect(notCalling).toEqual([]);
    });
  });
});
