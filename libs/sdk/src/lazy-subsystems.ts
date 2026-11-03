// The CommonJS build's `./subsystems` (see esbuild.cjs.config.js): a subsystem loads the first time one of its exports is read.
{
  const defineLazyExports = (load: () => Record<string, unknown>, names: readonly string[]): void => {
    let loaded: Record<string, unknown> | undefined;
    for (const name of names) {
      Object.defineProperty(exports, name, { enumerable: true, get: () => (loaded ??= load())[name] });
    }
  };

  defineLazyExports(
    () => require('./remote-mcp'),
    [
      'CapabilityCache',
      'CircuitBreaker',
      'CircuitBreakerManager',
      'CircuitOpenError',
      'HealthCheckManager',
      'HealthChecker',
      'McpClientService',
      'buildRemotePromptRecord',
      'buildRemoteResourceRecord',
      'buildRemoteResourceTemplateRecord',
      'buildRemoteToolRecord',
      'createRemotePromptContextClass',
      'createRemotePromptInstance',
      'createRemoteResourceContextClass',
      'createRemoteResourceInstance',
      'createRemoteResourceTemplateInstance',
      'createRemoteToolContextClass',
      'createRemoteToolInstance',
      'isAuthError',
      'isConnectionError',
      'isTransientError',
      'withRetry',
    ],
  );
  defineLazyExports(
    () => require('./remote-mcp/mcp-stateless-client.adapter'),
    ['McpStatelessClientAdapter', 'negotiateRemoteProtocol'],
  );
  defineLazyExports(
    () => require('./esm-loader'),
    [
      'DEFAULT_NPM_REGISTRY',
      'ESM_SH_BASE_URL',
      'EsmCacheManager',
      'EsmModuleLoader',
      'MANIFEST_PRIMITIVE_KEYS',
      'VersionPoller',
      'VersionResolver',
      'buildEsmPromptRecord',
      'buildEsmResourceRecord',
      'buildEsmShUrl',
      'buildEsmToolRecord',
      'compareVersions',
      'createEsmPromptContextClass',
      'createEsmPromptInstance',
      'createEsmResourceContextClass',
      'createEsmResourceInstance',
      'createEsmToolContextClass',
      'createEsmToolInstance',
      'esmRegistryAuthSchema',
      'frontMcpPackageManifestSchema',
      'getRegistryUrl',
      'isNewerVersion',
      'isPackageSpecifier',
      'isValidRange',
      'isValidVersion',
      'maxSatisfying',
      'normalizeEsmExport',
      'parsePackageSpecifier',
      'resolveRegistryToken',
      'satisfiesRange',
    ],
  );
  defineLazyExports(
    () => require('./job'),
    ['JobRegistry', 'JobInstance', 'JobPermissionGuard', 'JobExecutionManager', 'JobEmitter', 'JobRunResource'],
  );
  defineLazyExports(
    () => require('./job/tools'),
    ['ExecuteJobTool', 'GetJobStatusTool', 'CancelJobTool', 'ListJobsTool', 'RegisterJobTool', 'RemoveJobTool'],
  );
  defineLazyExports(
    () => require('./workflow'),
    ['WorkflowRegistry', 'WorkflowInstance', 'WorkflowEngine', 'WorkflowStepExecutor', 'WorkflowEmitter'],
  );
  defineLazyExports(
    () => require('./workflow/tools'),
    ['ExecuteWorkflowTool', 'GetWorkflowStatusTool', 'ListWorkflowsTool', 'RegisterWorkflowTool', 'RemoveWorkflowTool'],
  );
  defineLazyExports(
    () => require('./transport/adapters/streamable-http-transport'),
    ['RecreateableStreamableHTTPServerTransport'],
  );
  defineLazyExports(() => require('./transport/adapters/sse-transport'), ['RecreateableSSEServerTransport']);
  defineLazyExports(() => require('#sse-transport'), ['SSEServerTransport']);
  defineLazyExports(
    () => require('./transport/event-stores'),
    ['createEventStore', 'MemoryEventStore', 'RedisEventStore'],
  );
  defineLazyExports(
    () => require('./channel'),
    [
      'ChannelInstance',
      'ChannelRegistry',
      'ChannelEmitter',
      'ChannelNotificationService',
      'ChannelEventBus',
      'ChannelReplyTool',
    ],
  );
}
