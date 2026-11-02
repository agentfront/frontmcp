import { type Token } from '@frontmcp/di';
import { z } from '@frontmcp/lazy-zod';

import { type EntryOwnerRef } from '../entries/base.entry';
import { type ProviderRegistryInterface } from '../interfaces/internal';
import { type FlowName } from './flow.metadata';

/** A `did` hook runs only when its stage succeeds; a `finally` hook runs on every outcome and cannot change it. */
export type HookStageType = 'stage' | 'will' | 'did' | 'around' | 'finally';
export type HookPriority = number;

/**
 * Named priorities for what a hook does on its stage, in run order. They leave room between them for a hook to run
 * in between (`HookPhase.guard + 10`), and the default priority, 0, runs after `resolve` and before `guard`.
 */
export const HookPhase = {
  /** Fills in what later hooks read: a resolved name, a tenant, defaults. */
  resolve: -100,
  /** Refuses a call: approval (at `guard`) and feature flags (at 50) sit here. */
  guard: 100,
  /** Watches a call the guards let through: timing, audit. */
  observe: 300,
  /** Rewrites what the stage hands on, such as folding or trimming an answer. */
  shape: 500,
} as const;

/**
 * Which entries a hook of a plugin installed on an app runs for, in the flows about one entry
 * (`tools/call`, `resources/read`, `prompts/get`, `completion/complete`). Hooks of server-level
 * plugins, and every hook in list flows, run for every app's entries regardless.
 *
 * - `'own-app'` (default): only the entries of the app the plugin is installed on.
 * - `'uncovered-apps'`: those, plus the entries of any other app for which no instance of the
 *   same hook (same class and method) runs, from that app or from a server-level plugin. Meant
 *   for gates that metadata on an entry asks for, such as approval or feature flags, so an entry
 *   in an app without the plugin is not left ungated.
 * - `'all-apps'`: the entries of every app in the scope, as a server-level plugin's hook, whether or not
 *   their app has an instance of the same hook (then both run). Unlike `@Plugin({ scope: 'server' })`, it
 *   applies to this hook alone, and it reaches the apps of the scope it is registered in only: a standalone
 *   app, or each app under `splitByApp`, is a scope of its own.
 */
export type HookAppliesTo = 'own-app' | 'uncovered-apps' | 'all-apps';

/**
 * A hook `before` or `after` names: the `name` of a plugin or the name of the class that declares the hook (a
 * plugin, provider or entry class), alone for every hook it has on the stage, or followed by `.method` for one.
 */
export type HookTarget = string;

export interface HookOptions<Ctx> {
  /** Lowest runs first (default 0), and the lowest Around is outermost; ties run plugin and provider hooks in registration order, then the flow's own step, then the entry class's hooks. */
  priority?: HookPriority;
  filter?: (ctx: Ctx) => boolean | Promise<boolean>;
  appliesTo?: HookAppliesTo;
  /** Hooks of the same stage and type this one runs before, whatever their priority; an Around hook wraps them. */
  before?: readonly HookTarget[];
  /** Hooks of the same stage and type this one runs after, whatever their priority; an Around hook runs inside them. */
  after?: readonly HookTarget[];
}

const hookTargetsSchema = z.array(
  z
    .string({ message: 'a hook target is a plugin name or a class name, optionally followed by .method' })
    .trim()
    .min(1, 'a hook target is a plugin name or a class name, optionally followed by .method'),
  { message: 'must be an array of plugin or class names, each optionally followed by .method' },
);

/** The hook options a decorator checks when it is applied: `filter` and `priority` are left as they are. */
export const hookOptionsSchema = z.looseObject({
  appliesTo: z
    .enum(['own-app', 'uncovered-apps', 'all-apps'], { message: "must be 'own-app', 'uncovered-apps' or 'all-apps'" })
    .optional(),
  before: hookTargetsSchema.optional(),
  after: hookTargetsSchema.optional(),
});

export interface TokenHookMetadata {
  hooks: HookMetadata[];
}

/** The flow run a hook declared on a CONTEXT-scoped provider is about to join. */
export interface HookContextRun {
  /** The session (or request) key the run builds CONTEXT-scoped providers for. */
  sessionKey: string;
  /** The CONTEXT-scoped instances the run already built (its flow dependencies). */
  contextProviders: ReadonlyMap<Token, unknown>;
  /** The provider registry that built `contextProviders` (the scope's). */
  contextSource: ProviderRegistryInterface;
}

export interface HookMetadata<Name extends FlowName = FlowName, Stage = string, Ctx = any> extends HookOptions<Ctx> {
  type: HookStageType;
  flow: Name;
  stage: Stage;
  target: Token | null; // null for TC39 decorators until resolved at execution time
  method: string;
  static?: boolean;
  owner?: EntryOwnerRef;
  /** Set by the SDK: the `name` of the plugin that registered the hook, which `before` and `after` can name. */
  pluginName?: string;
  /**
   * Set by the SDK on a hook declared on a CONTEXT-scoped provider: builds (or reuses) the instance of
   * that provider for the run, which the hook then runs on in place of `target`.
   *
   * @internal
   */
  contextTarget?: (run: HookContextRun) => Promise<object | undefined>;
}
