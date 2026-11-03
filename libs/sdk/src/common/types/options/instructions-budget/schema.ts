import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';

/** The default size limits, in characters, of `instructionsBudget`. */
export const DEFAULT_INSTRUCTIONS_BUDGET = { instructions: 1024, toolDescription: 1024 } as const;

export interface InstructionsBudgetOptionsInterface {
  /**
   * Most characters the `initialize` instructions may have: the server's `instructions`, the channel hints and the
   * skills line or catalog. Some clients copy them into every tool's description.
   * @default 1024
   */
  instructions?: number;

  /**
   * Most characters a tool's `description` may have.
   * @default 1024
   */
  toolDescription?: number;
}

const characterLimit = (field: string) =>
  z
    .number({ message: `instructionsBudget.${field} must be a number of characters` })
    .int(`instructionsBudget.${field} must be a whole number of characters`)
    .positive(`instructionsBudget.${field} must be greater than 0`);

export const instructionsBudgetOptionsSchema = z.union(
  [
    z.literal(false),
    z
      .object({
        instructions: characterLimit('instructions').optional(),
        toolDescription: characterLimit('toolDescription').optional(),
      } satisfies RawZodShape<InstructionsBudgetOptionsInterface>)
      .strict(),
  ],
  { message: 'instructionsBudget must be false or { instructions?: number, toolDescription?: number }' },
);

export type InstructionsBudgetOptionsInput = z.input<typeof instructionsBudgetOptionsSchema>;

/** The limits a budget resolves to, or `undefined` when `instructionsBudget` is `false`. */
export type InstructionsBudget = Required<InstructionsBudgetOptionsInterface>;

/** The limits `instructionsBudget` sets, with the defaults for the ones it leaves out. */
export function resolveInstructionsBudget(
  option: InstructionsBudgetOptionsInput | undefined,
): InstructionsBudget | undefined {
  if (option === false) return undefined;
  return {
    instructions: option?.instructions ?? DEFAULT_INSTRUCTIONS_BUDGET.instructions,
    toolDescription: option?.toolDescription ?? DEFAULT_INSTRUCTIONS_BUDGET.toolDescription,
  };
}
