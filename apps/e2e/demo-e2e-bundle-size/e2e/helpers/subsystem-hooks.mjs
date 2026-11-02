// Requires the SDK's CommonJS build, runs a job, a workflow, a channel notification, the channel list, a remote app's
// tool, an ESM package's tool and a request to each OAuth route of a public-mode server, and prints, as JSON, the
// flows a server plugin's hooks saw, on its last line: node subsystem-hooks.mjs <dist/index.js>
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const [entry] = process.argv.slice(2);
const sdk = createRequire(import.meta.url)(entry);
const {
  App,
  Channel,
  ChannelContext,
  FlowHooksOf,
  FrontMcpInstance,
  Job,
  JobContext,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
} = sdk;
const { Workflow, connect, z } = sdk;

const OAUTH_ROUTES = {
  'oauth:authorize': ['GET', '/oauth/authorize'],
  'oauth:token': ['POST', '/oauth/token'],
  'oauth:userinfo': ['GET', '/oauth/userinfo'],
  'oauth:callback': ['GET', '/oauth/callback'],
  'oauth:connect': ['GET', '/oauth/connect'],
  'oauth:register': ['POST', '/oauth/register'],
  'oauth:provider-callback': ['GET', '/oauth/provider/upstream/callback'],
  'oauth:auth-ui-extra': ['POST', '/oauth/ui/extra'],
};

const seen = [];

function decorate(target, name, decorator) {
  decorator(target, name, Object.getOwnPropertyDescriptor(target, name));
}

class SubsystemHooksPlugin {
  recordJob(flowCtx) {
    const { job, workflow } = flowCtx.state;
    seen.push(workflow ? `jobs:execute-job ${job.name} in ${workflow.name}` : `jobs:execute-job ${job.name}`);
  }
  recordChannelSend() {
    seen.push('channels:send-notification');
  }
  recordChannelList() {
    seen.push('channels:list');
  }
  recordToolCall(flowCtx) {
    const tool = flowCtx.rawInput.request.params.name;
    if (tool.startsWith('remote') || tool.startsWith('esm')) seen.push(`tools:call-tool ${tool}`);
  }
}
decorate(SubsystemHooksPlugin.prototype, 'recordJob', FlowHooksOf('jobs:execute-job').Did('updateRunState'));
decorate(SubsystemHooksPlugin.prototype, 'recordChannelSend', FlowHooksOf('channels:send-notification').Will('send'));
decorate(SubsystemHooksPlugin.prototype, 'recordChannelList', FlowHooksOf('channels:list').Will('listChannels'));
decorate(SubsystemHooksPlugin.prototype, 'recordToolCall', FlowHooksOf('tools:call-tool').Will('parseInput'));
for (const flow of Object.keys(OAUTH_ROUTES)) {
  const method = `record:${flow}`;
  SubsystemHooksPlugin.prototype[method] = () => seen.push(flow);
  decorate(SubsystemHooksPlugin.prototype, method, FlowHooksOf(flow).Will('checkIpFilter'));
}
Plugin({ name: 'subsystem-hooks', description: 'Records the flows of each subsystem that ran' })(SubsystemHooksPlugin);

class GreetJob extends JobContext {
  async execute({ name }) {
    return { message: `Hello, ${name}` };
  }
}
Job({ name: 'greet', inputSchema: { name: z.string() }, outputSchema: { message: z.string() } })(GreetJob);

class GreetWorkflow {}
Workflow({ name: 'greet-twice', steps: [{ id: 'greet', jobName: 'greet', input: { name: 'Workflow' } }] })(
  GreetWorkflow,
);

class AlertChannel extends ChannelContext {
  async onEvent(payload) {
    return { content: `alert: ${payload.message}` };
  }
}
Channel({ name: 'alerts', source: { type: 'app-event', event: 'alert' } })(AlertChannel);

class AlertTool extends ToolContext {
  async execute() {
    this.scope.channelEventBus.emit('alert', { message: 'raised' });
    await this.scope.runFlow('channels:list', {});
    return 'raised';
  }
}
Tool({ name: 'raise-alert', inputSchema: {} })(AlertTool);

class SubsystemsApp {}
App({
  name: 'Subsystems',
  jobs: [GreetJob],
  workflows: [GreetWorkflow],
  channels: [AlertChannel],
  tools: [AlertTool],
})(SubsystemsApp);

class ShoutTool extends ToolContext {
  async execute() {
    return 'HELLO';
  }
}
Tool({ name: 'shout', inputSchema: {} })(ShoutTool);
class RemoteApp {}
App({ name: 'Remote', tools: [ShoutTool] })(RemoteApp);

function listen(server) {
  return new Promise((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen(server.address().port)));
}

const portProbe = createServer();
const remotePort = await listen(portProbe);
await new Promise((resolveClose) => portProbe.close(resolveClose));
const remote = await FrontMcpInstance.bootstrap({
  info: { name: 'remote', version: '1.0.0' },
  apps: [RemoteApp],
  http: { port: remotePort },
  logging: { level: LogLevel.Off },
});

const ESM_PACKAGE = '@frontmcp-e2e/wave-tools';
const ESM_BUNDLE = `module.exports = { default: { name: '${ESM_PACKAGE}', version: '1.0.0', tools: [{
  name: 'wave', description: 'Waves', inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ content: [{ type: 'text', text: 'wave' }] }),
}] } };`;
const esmPackages = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).slice(1);
  if (path === ESM_PACKAGE) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        name: ESM_PACKAGE,
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { name: ESM_PACKAGE, version: '1.0.0' } },
        time: { '1.0.0': new Date().toISOString() },
      }),
    );
  } else if (path === `${ESM_PACKAGE}@1.0.0`) {
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end(ESM_BUNDLE);
  } else {
    response.writeHead(404);
    response.end();
  }
});
const esmPort = await listen(esmPackages);

const config = {
  info: { name: 'subsystem-hooks', version: '1.0.0' },
  loader: { url: `http://127.0.0.1:${esmPort}` },
  apps: [
    SubsystemsApp,
    { name: 'remote', urlType: 'url', url: `http://127.0.0.1:${remotePort}/`, namespace: 'remote', standalone: false },
    App.esm(`${ESM_PACKAGE}@^1.0.0`, { namespace: 'esm' }),
  ],
  plugins: [SubsystemHooksPlugin],
  jobs: { enabled: true },
  channels: { enabled: true },
  logging: { level: LogLevel.Off },
};

const client = await connect(config);
try {
  await client.callTool('execute_job', { name: 'greet', input: { name: 'Ada' } });
  await client.callTool('execute_workflow', { name: 'greet-twice' });
  await client.callTool('raise-alert', {});
  const tools = await client.listTools();
  for (const { name } of tools.filter((tool) => tool.name.startsWith('remote') || tool.name.startsWith('esm'))) {
    await client.callTool(name, {});
  }
  await new Promise((resolveDelivery) => setTimeout(resolveDelivery, 100));
} finally {
  await client.close();
}

const handler = await FrontMcpInstance.createFetchHandler(config);
for (const [method, path] of Object.values(OAUTH_ROUTES)) {
  const response = await handler(new Request(`http://localhost${path}`, { method }));
  await response.arrayBuffer();
}

await remote?.shutdown?.();
esmPackages.close();
process.stdout.write(`\n${JSON.stringify(seen)}\n`);
process.exit(0);
