// Public-API regression for issue #408.
//
// The job/workflow management tool classes must be reachable from the SDK
// barrel AND via the `@frontmcp/sdk/job/tools` / `@frontmcp/sdk/workflow/tools`
// subpath exports so projects can opt out of auto-registration and register
// a subset manually via @App({ tools: [...] }).

describe('issue #408 — public exports for job/workflow management tools', () => {
  it('re-exports all five job tool classes from the main barrel', async () => {
    const sdk = await import('../index');
    expect(typeof (sdk as Record<string, unknown>)['ExecuteJobTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['GetJobStatusTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['ListJobsTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['RegisterJobTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['RemoveJobTool']).toBe('function');
  });

  it('re-exports all five workflow tool classes from the main barrel', async () => {
    const sdk = await import('../index');
    expect(typeof (sdk as Record<string, unknown>)['ExecuteWorkflowTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['GetWorkflowStatusTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['ListWorkflowsTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['RegisterWorkflowTool']).toBe('function');
    expect(typeof (sdk as Record<string, unknown>)['RemoveWorkflowTool']).toBe('function');
  });

  it('re-exports the same class from the ./job/tools subpath barrel and the main barrel', async () => {
    const sdk = await import('../index');
    const jobTools = await import('../job/tools');
    expect((sdk as Record<string, unknown>)['ExecuteJobTool']).toBe(
      (jobTools as Record<string, unknown>)['ExecuteJobTool'],
    );
    expect((sdk as Record<string, unknown>)['ListJobsTool']).toBe(
      (jobTools as Record<string, unknown>)['ListJobsTool'],
    );
  });

  it('re-exports the same class from the ./workflow/tools subpath barrel and the main barrel', async () => {
    const sdk = await import('../index');
    const workflowTools = await import('../workflow/tools');
    expect((sdk as Record<string, unknown>)['ExecuteWorkflowTool']).toBe(
      (workflowTools as Record<string, unknown>)['ExecuteWorkflowTool'],
    );
    expect((sdk as Record<string, unknown>)['ListWorkflowsTool']).toBe(
      (workflowTools as Record<string, unknown>)['ListWorkflowsTool'],
    );
  });
});

describe('issue #408 — snake_case tool naming', () => {
  it.each([
    ['ExecuteJobTool', 'execute_job'],
    ['GetJobStatusTool', 'get_job_status'],
    ['ListJobsTool', 'list_jobs'],
    ['RegisterJobTool', 'register_job'],
    ['RemoveJobTool', 'remove_job'],
  ])('%s decorator exposes snake_case `name: %s`', async (className, expectedName) => {
    const sdk = (await import('../index')) as Record<string, unknown>;
    const { normalizeTool } = (await import('../tool/tool.utils')) as {
      normalizeTool: (c: unknown) => { metadata: { name: string } };
    };
    const ToolCls = sdk[className];
    const record = normalizeTool(ToolCls);
    expect(record.metadata.name).toBe(expectedName);
  });

  it.each([
    ['ExecuteWorkflowTool', 'execute_workflow'],
    ['GetWorkflowStatusTool', 'get_workflow_status'],
    ['ListWorkflowsTool', 'list_workflows'],
    ['RegisterWorkflowTool', 'register_workflow'],
    ['RemoveWorkflowTool', 'remove_workflow'],
  ])('%s decorator exposes snake_case `name: %s`', async (className, expectedName) => {
    const sdk = (await import('../index')) as Record<string, unknown>;
    const { normalizeTool } = (await import('../tool/tool.utils')) as {
      normalizeTool: (c: unknown) => { metadata: { name: string } };
    };
    const ToolCls = sdk[className];
    const record = normalizeTool(ToolCls);
    expect(record.metadata.name).toBe(expectedName);
  });
});
