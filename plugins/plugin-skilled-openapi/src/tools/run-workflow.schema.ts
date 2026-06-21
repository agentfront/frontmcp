import { z } from '@frontmcp/lazy-zod';

export const runWorkflowDescription = `Execute a task by running a short AgentScript program in a secure sandbox (enclave).

This is the EXECUTE step of the skill mechanism. After \`search_skill\` (to find a
skill) and \`load_skill\` (to read its instructions + the actions it offers), write
a program that calls those actions to accomplish the user's task — chaining
several calls in ONE round-trip, with each call authorized, schema-validated, and
sent to the real upstream API (credentials injected from the vault, never echoed).

Inside the script:
  - \`await callTool(actionId, input)\` invokes a loaded skill's action (the
    \`actionId\` is what \`load_skill\` lists under \`actions[]\`). It returns the
    action's response \`data\`, or throws if the action is unknown / unauthorized /
    fails validation.
  - \`Math\` and \`JSON\` are available. There is NO host access and NO network
    except through \`callTool\`.
  - The script's final \`return <value>\` is the result.

Example (after loading a skill exposing getTodo + getUser):
  const t = await callTool("getTodo", { id: 1 });
  const u = await callTool("getUser", { id: t.userId });
  return { todo: t.title, owner: u.name };

OUTPUT: { success, value?, error?, stats }`;

export const runWorkflowInputSchema = {
  script: z
    .string()
    .min(1)
    .max(20000)
    .describe('AgentScript source. Use `await callTool(actionId, input)` for loaded skill actions; end with `return <value>`.'),
};

export const runWorkflowOutputSchema = {
  success: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().optional(),
  stats: z
    .object({
      durationMs: z.number(),
      toolCalls: z.number(),
      steps: z.number(),
    })
    .optional(),
};

export type RunWorkflowInput = { script: string };
export type RunWorkflowOutput = {
  success: boolean;
  value?: unknown;
  error?: string;
  stats?: { durationMs: number; toolCalls: number; steps: number };
};
