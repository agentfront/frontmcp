import { resolveInstructionsBudget } from '../common/types/options/instructions-budget';
import { composeCallerInstructions, type InstructionsScope } from '../skill/skill-instructions.helper';
import { findBudgetOverruns } from './manifest-lint';

type BudgetedScope = InstructionsScope & {
  readonly tools: { getTools(): ReadonlyArray<{ name: string; metadata: { description?: string } }> };
};

/** The startup warnings for the instructions and listed tool descriptions over the scope's `instructionsBudget`. */
export async function describeBudgetOverruns(scope: BudgetedScope): Promise<string[]> {
  const budget = resolveInstructionsBudget(scope.metadata.instructionsBudget);
  if (!budget) return [];
  const instructions = await composeCallerInstructions(scope, { skillUriHints: true });
  const tools = scope.tools.getTools().map((tool) => ({ name: tool.name, description: tool.metadata.description }));
  return findBudgetOverruns({ instructions, tools }, budget).map((finding) => finding.message);
}
