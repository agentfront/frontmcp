// file: libs/sdk/src/hooks/entry-class-hooks.ts

import { type FlowName, type FlowPhase, type HookRecord } from '../common';

/** A flow's plan: its stages by phase. */
type EntryFlowPlan = Partial<Record<FlowPhase, readonly string[]>>;

/**
 * Where the hooks an entry class (`@Tool`, `@Resource`, `@Prompt`, `@Agent`) declares join a run of
 * the flow that serves the entry. They run on the instance built for the call, so they join while
 * the stage that builds it runs.
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
 * - on its own flow, a stage the run passes before the entry's instance exists (and `Will` or
 *   `Around` on the stage that builds it);
 * - on a list flow, which lists entries without building any instance.
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
    const label = `${metadata.method}() (${metadata.type} '${String(metadata.stage)}' of ${metadata.flow})`;
    if (listFlows.includes(metadata.flow)) {
      problems.push(`${label}: list flows build no entry instance to run it on`);
      continue;
    }
    if (metadata.flow !== join.flow) continue;
    const index = stages.indexOf(String(metadata.stage));
    const tooEarly =
      index !== -1 &&
      (index < contextIndex || (index === contextIndex && (metadata.type === 'will' || metadata.type === 'around')));
    if (tooEarly) {
      problems.push(`${label}: runs before '${join.contextStage}' builds the instance it runs on`);
    }
  }
  return problems;
}

/** The startup error for an entry class whose hooks would never run. */
export function unreachableHooksMessage(kind: string, className: string, problems: readonly string[]): string {
  return (
    `${kind} "${className}" declares hooks that would never run: ${problems.join('; ')}. ` +
    `Hooks declared on a ${kind.toLowerCase()} class run on the instance built for each call. ` +
    `Declare hooks for earlier stages, and for list flows, on a provider or a plugin instead.`
  );
}
