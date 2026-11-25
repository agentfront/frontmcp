import { z } from '@frontmcp/lazy-zod';

import { pausedRunSchema } from './execute.schema';

const runIdSchema = z.string().uuid().describe('The runId of a codecall:execute or codecall:resume result');

export const resumeToolDescription = `Resume a run that paused before a call that did not run.

A codecall:execute result with "paused" stopped before that call (it needed approval, or its input was refused) and kept everything before it.
Resume runs the same script again: the calls before the paused one get their recorded results without running again, and the paused call runs now, then the rest of the script.
Fix the cause first (a person approves it, or send corrected "arguments" for that call only). Recorded results and the script's variables never change.
The answer is a codecall:execute result: it may pause again at a later call. Resume a run once; after "expiresAt" it is not found.`;

export const resumeToolInputSchema = {
  runId: runIdSchema,
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Corrected arguments for the call the run paused before; every other call keeps its own'),
};

export type ResumeToolInput = z.infer<z.ZodObject<typeof resumeToolInputSchema>>;

export const statusToolDescription = `The status of a run: how it ended, or that it is paused before a call (and until when), or being resumed, or cancelled.`;

export const cancelToolDescription = `Cancel a paused run: it can no longer be resumed. The calls it already made keep their effects.`;

export const runIdToolInputSchema = { runId: runIdSchema };

export type RunIdToolInput = z.infer<z.ZodObject<typeof runIdToolInputSchema>>;

export const runStatusOutputSchema = z.object({
  runId: z.string(),
  /** How the run ended (a codecall:execute status), `paused`, `resuming` while a resume runs it, or `cancelled`. */
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  /** The calls its journal holds. */
  calls: z.number(),
  paused: pausedRunSchema.optional(),
});

export type RunStatusOutput = z.infer<typeof runStatusOutputSchema>;
