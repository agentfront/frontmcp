// file: libs/sdk/src/hooks/entry-class-hooks.ts

import { type FlowName, type FlowPhase, type HookRecord } from '../common';

/** A flow's plan: its stages by phase. */
type EntryFlowPlan = Partial<Record<FlowPhase, readonly string[]>>;

/**
 * Where the hooks an entry class (`@Tool`, `@Resource`, `@Prompt`, `@Agent`, `@Job`) declares join a
 * run of the flow that serves the entry. Instance methods run on the instance built for the call, so
 * they join while the stage that builds it runs; `static` methods need no instance and join when the
 * run starts (#701).
 */
export interface EntryClassHooksJoin {
  /** The flow that serves the entry (`tools:call-tool`, ...). */
  flow: FlowName;
  /** That flow's plan. */
  plan: EntryFlowPlan;
  /** The stage that builds the entry's instance. */
  contextStage: string;
}

/** The stages of a plan, in the order a run reaches them. */
function stagesInOrder(plan: EntryFlowPlan): string[] {
  return [
    ...(plan.pre ?? []),
    ...(plan.execute ?? []),
    ...(plan.post ?? []),
    ...(plan.finalize ?? []),
    ...(plan.error ?? []),
  ];
}

/**
 * The hooks an entry class declares that can never run, each described for a startup error:
 * - on its own flow, an instance method on a stage the run passes before the entry's instance exists
 *   (and `Will` or `Around` on the stage that builds it); a `static` method runs without an instance,
 *   so it may hook any stage of the entry's own flow (#701);
 * - on a list flow, which lists entries without building any instance or resolving one entry.
 */
export function describeUnreachableEntryClassHooks(
  hooks: readonly HookRecord[],
  join: EntryClassHooksJoin,
  listFlows: readonly string[],
): string[] {
  const stages = stagesInOrder(join.plan);
  const contextIndex = stages.indexOf(join.contextStage);
  const problems: string[] = [];
  for (const { metadata } of hooks) {
    const kind = metadata.static ? 'static ' : '';
    const label = `${kind}${metadata.method}() (${metadata.type} '${String(metadata.stage)}' of ${metadata.flow})`;
    if (listFlows.includes(metadata.flow)) {
      problems.push(`${label}: list flows build no entry instance and resolve no single entry to run it for`);
      continue;
    }
    if (metadata.flow !== join.flow || metadata.static) continue;
    const index = stages.indexOf(String(metadata.stage));
    const tooEarly =
      index !== -1 &&
      (index < contextIndex || (index === contextIndex && (metadata.type === 'will' || metadata.type === 'around')));
    if (tooEarly) {
      problems.push(
        `${label}: runs before '${join.contextStage}' builds the instance it runs on; ` +
          `declare it as a static method to run it without an instance`,
      );
    }
  }
  return problems;
}

/** The startup error for an entry class whose hooks would never run. */
export function unreachableHooksMessage(kind: string, className: string, problems: readonly string[]): string {
  return (
    `${kind} "${className}" declares hooks that would never run: ${problems.join('; ')}. ` +
    `Hooks declared as instance methods on a ${kind.toLowerCase()} class run on the instance built for each call; ` +
    `static methods run without one, from the first stage of a call. ` +
    `Declare hooks for list flows on a provider or a plugin instead.`
  );
}
