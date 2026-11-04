import type { CallToolResult, McpTestClient, TestFixtures } from '@frontmcp/testing';

export const SKILLED_SERVER = {
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/main.ts',
  project: 'demo-e2e-skilled-openapi',
  publicMode: true,
} as const;

export interface SearchSkillResponse {
  skills: Array<{ skillId: string; name: string; description: string; score: number; bundleVersion?: string }>;
}

export interface LoadedSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  bundleVersion?: string;
  actions?: Array<{
    actionId: string;
    summary: string;
    inputJsonSchema: Record<string, unknown>;
    outputJsonSchema: Record<string, unknown>;
    requiredAuthorities?: Record<string, unknown>;
  }>;
}

export interface LoadSkillResponse {
  skill?: LoadedSkill;
  isComplete?: boolean;
  skills?: Array<{ skill: LoadedSkill; isComplete: boolean }>;
}

export interface RunWorkflowResponse {
  success: boolean;
  value?: unknown;
  error?: string;
  stats?: { durationMs: number; toolCalls: number; steps: number };
}

/** A client whose verified token carries `roles` where the server's claimsMapping reads them (`realm_access.roles`). */
async function connectWithRoles(
  { auth, server }: Pick<TestFixtures, 'auth' | 'server'>,
  sub: string,
  roles: string[],
): Promise<McpTestClient> {
  const token = await auth.createToken({ sub, claims: { realm_access: { roles } } });
  return server.createClient({ token });
}

export const asAdmin = (fixtures: Pick<TestFixtures, 'auth' | 'server'>) =>
  connectWithRoles(fixtures, 'alice', ['admin']);
export const asViewer = (fixtures: Pick<TestFixtures, 'auth' | 'server'>) =>
  connectWithRoles(fixtures, 'vera', ['viewer']);

export async function searchSkillIds(client: McpTestClient, args: Record<string, unknown>): Promise<string[]> {
  const result = await client.tools.call('search_skill', args);
  return result.json<SearchSkillResponse>().skills.map((skill) => skill.skillId);
}

export async function loadSkill(client: McpTestClient, skillId: string): Promise<LoadedSkill | undefined> {
  const result = await client.tools.call('load_skill', { skillId });
  return result.isError ? undefined : result.json<LoadSkillResponse>().skill;
}

export async function runWorkflow(client: McpTestClient, script: string): Promise<RunWorkflowResponse> {
  const result = await client.tools.call('run_workflow', { script });
  return result.json<RunWorkflowResponse>();
}

export function actionIdsOf(skill: LoadedSkill | undefined): string[] {
  return (skill?.actions ?? []).map((action) => action.actionId).sort();
}

/** Calls a tool and returns the raw result, over whichever transport the caller uses. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

export function callToolOver(client: McpTestClient): CallTool {
  return async (name, args) => (await client.tools.call(name, args)).raw;
}

/** `getInvoice` is listed by the public invoices skill and the admin-only skill; `voidInvoice` by the admin-only skill alone. */
const SHARED_AND_ADMIN_ONLY_ACTIONS = ['getInvoice', 'voidInvoice'];

/** Of the actions in SHARED_AND_ADMIN_ONLY_ACTIONS, the ones load_skill shows the caller and the ones its run_workflow calls run. */
export async function sharedOperationAccess(callTool: CallTool): Promise<{ shown: string[]; runnable: string[] }> {
  const shown = new Set<string>();
  for (const skillId of ['invoices', 'billing-admin']) {
    const loaded = await callTool('load_skill', { skillId });
    const skill = loaded.isError ? undefined : (loaded.structuredContent?.['skill'] as LoadedSkill | undefined);
    for (const actionId of actionIdsOf(skill)) shown.add(actionId);
  }

  const runnable: string[] = [];
  for (const actionId of SHARED_AND_ADMIN_ONLY_ACTIONS) {
    const script = `const created = await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 }); return await callTool('${actionId}', { id: created.id });`;
    const result = await callTool('run_workflow', { script });
    if (result.structuredContent?.['success'] === true) runnable.push(actionId);
  }
  return { shown: SHARED_AND_ADMIN_ONLY_ACTIONS.filter((actionId) => shown.has(actionId)), runnable };
}
